const fs = require("fs")
const Web3 = require("web3")
const { ethers: hardhatEthers, upgrades } = require('hardhat')
const {
    ContractFactory,
    utils: { computeAddress, parseEther, namehash, id },
    constants: {MaxUint256},
    getContractFactory,
    Wallet,
    providers: { JsonRpcProvider },
    constants: { AddressZero },
} = hardhatEthers

const TestTokenJson = require("./ethereumContractJSONs/TestToken.json")
const NodeRegistry = require("./ethereumContractJSONs/NodeRegistry.json")
const ENSRegistry = require("./ethereumContractJSONs/ENSRegistry.json")
const FIFSRegistrar = require("./ethereumContractJSONs/FIFSRegistrar.json")
const PublicResolver = require("./ethereumContractJSONs/PublicResolver.json")
const DATAv2 = require("./ethereumContractJSONs/DATAv2.json")

// Streamregistry and ENSCache using Chainlink
const LinkToken = require('./ethereumContractJSONs/LinkToken.json')
const ChainlinkOracle = require('./ethereumContractJSONs/Oracle.json')

const projectsData = require('./projectsData.json')

const sidechainURL = process.env.SIDECHAIN_URL || "http://10.200.10.1:8546"

const log = require("debug")("streamr:docker-dev-chain-init")

// how much to mint to each of the privateKeys
const mintAmountFullTokens = "1000000"

// "testrpc" mnemonic wallets, will have DATAv1 and DATAv2 tokens in them
const privateKeys = [
    "0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0", // this wallet will deploy most contracts and "own" them if applicable
    "0xe5af7834455b7239881b85be89d905d6881dcb4751063897f12be1b0dd546bdb", // was used in deploy_du2_factories
    "0x4059de411f15511a85ce332e7a428f36492ab4e87c7830099dadbf130f1896ae", // this wallet will deploy StreamRegistry and others
    "0x633a182fb8975f22aaad41e9008cb49a432e9fdfef37f151e9e7c54e96258ef9", // use this for new deployments
    "0x957a8212980a9a39bf7c03dcbeea3c722d66f2b359c669feceb0e3ba8209a297",
    "0xfe1d528b7e204a5bdfb7668a1ed3adfee45b4b96960a175c9ef0ad16dd58d728",
    "0xd7609ae3a29375768fac8bc0f8c2f6ac81c5f2ffca2b981e6cf15460f01efe14",
    "0xb1abdb742d3924a45b0a54f780f0f21b9d9283b231a0a0b35ce5e455fa5375e7",
    "0x2cd9855d17e01ce041953829398af7e48b24ece04ff9d0e183414de54dc52285",
]

// these come from the next step, but we can predict the addresses
// TODO: how are these predicted? Are they correct? How can we know?
const chainlinkNodeAddress = '0x7b5F1610920d5BAf00D684929272213BaF962eFe'
const chainlinkJobId = 'c99333d032ed4cb8967b956c7f0329b5'

async function main() {
    const provider = new JsonRpcProvider(sidechainURL)
    try {
        log("Network: %o", await provider.getNetwork())
    } catch (e) {
        console.error(e)
        process.exit(1)
    }

    const wallet = new Wallet(privateKeys[0], provider)
    const streamRegistryDeployer = new Wallet(privateKeys[2], provider)

    const { nodeRegistry, streamRegistry, linkToken, ensCache } = await deployStreamRegistries(streamRegistryDeployer)
    await deployENSCacheV2(wallet, streamRegistry, ensCache)
    const token = await deployTokens(wallet)

    const tokenomicsAddresses = await deploySponsorshipFactory(streamRegistryDeployer, token, streamRegistry)

    // 1st NodeRegistry deployed here. 2nd deployed inside deployStreamRegistries
    log(`Deploying NodeRegistry contract 1 (tracker registry) from ${wallet.address}`)
    let initialNodes = []
    let initialMetadata = []
    initialNodes.push('0xb9e7cEBF7b03AE26458E32a059488386b05798e8')
    initialMetadata.push('{"ws": "ws://10.200.10.1:30301", "http": "http://10.200.10.1:30301"}')
    initialNodes.push('0x0540A3e144cdD81F402e7772C76a5808B71d2d30')
    initialMetadata.push('{"ws": "ws://10.200.10.1:30302", "http": "http://10.200.10.1:30302"}')
    initialNodes.push('0xf2C195bE194a2C91e93Eacb1d6d55a00552a85E2')
    initialMetadata.push('{"ws": "ws://10.200.10.1:30303", "http": "http://10.200.10.1:30303"}')
    const trackerRegistry = await deployNodeRegistry(wallet, initialNodes, initialMetadata)

    const { ens, fifs, publicResolver } = await deployENS(wallet)

    const ssr = await deployStreamStorageRegistry(wallet, nodeRegistry.address, streamRegistry.address)

    const watcherDevopsKey = '0x628acb12df34bb30a0b2f95ec2e6a743b386c5d4f63aa9f338bec6f613160e78'
    const watcherWallet = new Wallet(watcherDevopsKey)
    const role = await streamRegistry.TRUSTED_ROLE()
    log(`granting role ${role} to devops ${watcherWallet.address}`)
    const grantRoleTx2 = await streamRegistry.grantRole(role, watcherWallet.address)
    await grantRoleTx2.wait()

    const projectRegistryV1 = await deployProjectRegistryV1(wallet, streamRegistry.address)

    await deployMarketplaceV3(wallet)

    const chainId = 8997 // dev1
    const market = await deployMarketplaceV4(wallet, projectRegistryV1.address, chainId)
    log(`Granting role ${role} to MarketplaceV4 at ${market.address}. ` +
        "Needed for granting permissions to streams using the trusted functions.")
    await(await projectRegistryV1.grantRole(id("TRUSTED_ROLE"), market.address)).wait()

    const projectStaking = await deployProjectStakingV1(wallet, projectRegistryV1.address, token.address)

    // granting here and not right after deployProjectRegistryV1 to avoid changing the addresses of MarketplaceV3, MarketplaceV4 and ProjectStakingV1
    log(`Granting role ${role} to ProjectRegistryV1 at ${projectRegistryV1.address}. ` +
        "Needed for granting permissions to streams using the trusted functions.")
    const grantRoleProjectRegistryV1Tx = await streamRegistry.grantRole(role, projectRegistryV1.address)
    await grantRoleProjectRegistryV1Tx.wait()

    log(`Adding ${projectsData.length} projects to ProjectRegistryV1`)
    for (const p of projectsData) {
        const tx = await projectRegistryV1.createProject(
            p.id,
            p.chainIds,
            p.paymentDetails,
            p.streams,
            p.minimumSubscriptionSeconds,
            p.isPublicPurchable,
            p.metadata
        )
        await tx.wait()
    }

    const jsonOutput = JSON.stringify({
        DATA: token.address,
        ENS: ens.address,
        LINK: linkToken.address,
        MarketplaceV4: market.address,
        FIFSRegistrar: fifs.address,
        PublicResolver: publicResolver.address,
        StreamRegistry: streamRegistry.address,
        StreamStorageRegistry: ssr.address,
        TrackerRegistry: trackerRegistry.address,
        StorageNodeRegistry: nodeRegistry.address,
        ProjectRegistryV1: projectRegistryV1.address,
        ProjectStakingV1: projectStaking.address,
        ...tokenomicsAddresses,
    }, null, 4)
    fs.writeFileSync("addresses.json", jsonOutput)
    console.log(jsonOutput)
}

/**
 * From https://github.com/ensdomains/ens/blob/master/migrations/2_deploy_contracts.js
 *
 * Calculate root node hashes given the top level domain(tld)
 *
 * @param {string} tld plain text tld, for example: 'eth'
 */
function getRootNodeFromTLD(tld) {
    return {
        namehash: namehash(tld),
        sha3: Web3.utils.sha3(tld)
    }
}

// deployment steps based on https://github.com/ensdomains/ens/blob/2a6785c3b5fc27269eb3bb18b9d1245d1f01d6c8/migrations/2_deploy_contracts.js#L30
async function deployENS(wallet) {
    log("Deploying ENS")
    const ensDeploy = new ContractFactory(ENSRegistry.abi, ENSRegistry.bytecode, wallet)
    const ensDeployTx = await ensDeploy.deploy()
    const ens = await ensDeployTx.deployed()
    log(`ENS deployed at ${ens.address}`)
    const rootNode = getRootNodeFromTLD('eth')
    log("Deploying FIFSRegistrar")
    const fifsDeploy = new ContractFactory(FIFSRegistrar.abi, FIFSRegistrar.bytecode, wallet)
    const fifsDeployTx = await fifsDeploy.deploy(ens.address, rootNode.namehash)
    const fifs = await fifsDeployTx.deployed()
    log(`FIFSRegistrar deployed at ${fifs.address}`)
    await (await ens.setSubnodeOwner('0x0000000000000000000000000000000000000000000000000000000000000000', rootNode.sha3, fifs.address)).wait()
    const resDeploy = new ContractFactory(PublicResolver.abi, PublicResolver.bytecode, wallet)
    const resDeployTx = await resDeploy.deploy(ens.address)
    const publicResolver = await resDeployTx.deployed()
    log(`PublicResolver deployed at ${publicResolver.address}`)

    const domains = ['testdomain1', 'testdomain2']
    const addresses = ['0x4178baBE9E5148c6D5fd431cD72884B07Ad855a0', '0xdC353aA3d81fC3d67Eb49F443df258029B01D8aB']
    for (var i = 0; i < domains.length; i++){
        const domain = domains[i]
        const owner = wallet.address
        const domainAddress = addresses[i]
        const fullname = domain + ".eth"
        const fullhash = namehash(fullname)

        log(`setting up ENS domain ${domain} with owner ${owner}, pointing to address ${domainAddress}`)
        await (await fifs.register(Web3.utils.sha3(domain), owner)).wait()
        log(`called fifs.register`)

        await (await ens.setResolver(fullhash, publicResolver.address)).wait()
        log('called ens.setResolver')

        //Ethers wont call the 2-arg setAddr. 60 is default = COIN_TYPE_ETH.
        //see https://github.com/ensdomains/resolvers/blob/master/contracts/profiles/AddrResolver.sol
        await (await publicResolver.setAddr(fullhash, 60, domainAddress)).wait()
        log(`called setAddr. done registering ${fullname} as ${domainAddress}`)

        //transfer ownership
        await (await ens.setOwner(fullhash, addresses[i])).wait()
        log(`transferred ownership to ${addresses[i]}`)
    }
    log("ENS init complete")

    return { ens, fifs, publicResolver }
}

async function deployTokens(wallet) {
    log(`Deploying test DATAv2 from ${wallet.address}`)
    const tokenDeployer = new ContractFactory(DATAv2.abi, DATAv2.bytecode, wallet)
    const tokenDeployTx = await tokenDeployer.deploy()
    const token = await tokenDeployTx.deployed()
    log(`New DATAv2 ERC20 deployed at ${token.address}`)

    //another ERC20 that's not datacoin for testing buy with Uniswap
    // log(`Deploying test OTHERcoin from ${wallet.address}`)
    const tokenDeployer2 = new ContractFactory(TestTokenJson.abi, TestTokenJson.bytecode, wallet)
    const tokenDeployTx2 = await tokenDeployer2.deploy("Test OTHERcoin", "COIN")
    const token2 = await tokenDeployTx2.deployed()
    log(`Test OTHERcoin deployed at ${token2.address}`)

    //Note: TestToken contract automatically mints 100000 to owner

    log('Add minter: %s', wallet.address)
    const addMinterTx = await token.grantRole(id("MINTER_ROLE"), wallet.address)
    await addMinterTx.wait()

    log(`Minting ${mintAmountFullTokens} DATAv2 tokens to following addresses:`)
    for (const address of privateKeys.slice(0, 3).map(computeAddress)) { // TODO: MINT TO ALL, remove slice!
        log("    %s", address)
        await (await token.mint(address, parseEther(mintAmountFullTokens))).wait()
    }

    // log(`Deploying test DATAv1 from ${wallet.address}`)
    // const oldTokenDeployer = new ContractFactory(OldTokenJson.abi, OldTokenJson.bytecode, wallet)
    // const oldTokenDeployTx = await oldTokenDeployer.deploy("Test DATAv1", "\uD83D\uDC34", 0, 18, true) // horse face
    // const oldToken = await oldTokenDeployTx.deployed()
    // log(`Old DATAv1 ERC20 deployed at ${oldToken.address}`)

    // log(`Deploying DataTokenMigrator from ${wallet.address}`)
    // const migratorDeployer = new ContractFactory(DataTokenMigrator.abi, DataTokenMigrator.bytecode, wallet)
    // const migratorDeployTx = await migratorDeployer.deploy(oldToken.address, token.address)
    // const migrator = await migratorDeployTx.deployed()
    // log(`New DataTokenMigrator at ${migrator.address}`)

    // log('Set up the old token and mint %s test-DATAv1 (in total) to %s:', oldSupply, wallet.address)
    // await (await oldToken.setReleaseAgent(wallet.address)).wait()
    // await (await oldToken.mint(wallet.address, oldSupply)).wait()
    // const oldTokenReleaseTx = await oldToken.releaseTokenTransfer()
    // await oldTokenReleaseTx.wait()
    // log('Old token getUpgradeState: %d, expected: 2', await oldToken.getUpgradeState())

    // log('Set migrator as UpgradeAgent => start test-DATAv1 upgrade')
    // const upgradeTx1 = await token.mint(migrator.address, await oldToken.totalSupply())
    // await upgradeTx1.wait()
    // const upgradeTx2 = await oldToken.setUpgradeAgent(migrator.address)
    // await upgradeTx2.wait()
    // log('Old token getUpgradeState: %d, expected: 3', await oldToken.getUpgradeState())

    return token
}

async function deployNodeRegistry(wallet, initialNodes, initialMetadata) {
    const strDeploy = new ContractFactory(NodeRegistry.abi, NodeRegistry.bytecode, wallet)
    const strDeployTx = await strDeploy.deploy(wallet.address, false, initialNodes, initialMetadata, {gasLimit: 6000000} )
    const str = await strDeployTx.deployed()
    log(`NodeRegistry deployed at ${str.address}`)
    const nodes = await str.getNodes()
    log(`NodeRegistry nodes : ${JSON.stringify(nodes)}`)
    return str
}

async function deployStreamStorageRegistry(wallet, nodeRegistryAddress, streamRegistryAddress) {
    const strDeploy = await getContractFactory("StreamStorageRegistryV2", wallet)
    // const strDeployTx = await strDeploy.deploy(streamRegistryAddress, nodeRegistryAddress, wallet.address, {gasLimit: 6000000} )
    const strDeployTx = await upgrades.deployProxy(strDeploy, [streamRegistryAddress, nodeRegistryAddress, AddressZero], {
        kind: 'uups'
    })
    const str = await strDeployTx.deployed()
    log(`StreamStorageRegistryV2 deployed at ${str.address}`)
    return str
}

async function deployProjectRegistryV1(wallet, streamRegistryAddress) {
    const projectRegistryFactory = await getContractFactory("ProjectRegistryV1", wallet)
    const projectRegistryFactoryTx = await upgrades.deployProxy(projectRegistryFactory, [streamRegistryAddress], { kind: 'uups' })
    const projectRegistry = await projectRegistryFactoryTx.deployed()
    log(`ProjectRegistry deployed at ${projectRegistry.address}`)
    return projectRegistry
}

async function deployProjectStakingV1(wallet, projectRegistryAddress, tokenStakingAddress) {
    const projectStakingV1Factory = await getContractFactory("ProjectStakingV1", wallet)
    const projectStakingV1FactoryTx = await upgrades.deployProxy(projectStakingV1Factory, [
        projectRegistryAddress,
        tokenStakingAddress
    ], { kind: 'uups' })
    const projectStakingV1 = await projectStakingV1FactoryTx.deployed()
    log(`ProjectStakingV1 deployed at ${projectStakingV1.address}`)
    return projectStakingV1
}

async function deployMarketplaceV3(wallet) {
    const marketplaceV3Factory = await getContractFactory("MarketplaceV3", wallet)
    const marketplaceV3FactoryTx = await upgrades.deployProxy(marketplaceV3Factory, [], { kind: 'uups' })
    const marketplaceV3 = await marketplaceV3FactoryTx.deployed()
    log(`MarketplaceV3 deployed on sidechain at ${marketplaceV3.address}`)
    return marketplaceV3
}

async function deployMarketplaceV4(wallet, projectRegistryAddress, destinationChainId) {
    const marketplaceV4Factory = await getContractFactory("MarketplaceV4", wallet)
    const marketplaceV4FactoryTx = await upgrades.deployProxy(marketplaceV4Factory, [projectRegistryAddress, destinationChainId], { kind: 'uups' })
    const marketplaceV4 = await marketplaceV4FactoryTx.deployed()
    log(`MarketplaceV4 deployed on sidechain at ${marketplaceV4.address}`)
    return marketplaceV4
}

async function deployStreamRegistries(wallet) {
    log('Sending some Ether to chainlink node address')
    await (await wallet.sendTransaction({
        to: chainlinkNodeAddress,
        value: parseEther('100')
    })).wait()

    log('Deploying Streamregistry and chainlink contracts to sidechain:')
    const linkTokenFactory = new ContractFactory(LinkToken.abi, LinkToken.bytecode, wallet)
    const linkTokenFactoryTx = await linkTokenFactory.deploy()
    const linkToken = await linkTokenFactoryTx.deployed()
    log(`Link Token deployed at ${linkToken.address}`)

    const oracleFactory = new ContractFactory(ChainlinkOracle.compilerOutput.abi,
        ChainlinkOracle.compilerOutput.evm.bytecode.object, wallet)
    const oracleFactoryTx = await oracleFactory.deploy(linkToken.address)
    const oracle = await oracleFactoryTx.deployed()
    log(`Chainlink Oracle deployed at ${oracle.address}`)
    const tokenaddrFromOracle = await oracle.getChainlinkToken()
    log(`Chainlink Oracle token pointing to ${tokenaddrFromOracle}`)
    const fulfilmentPermissionTX = await oracle.setFulfillmentPermission(chainlinkNodeAddress, true)
    await fulfilmentPermissionTX.wait()
    const permission = await oracle.getAuthorizationStatus(chainlinkNodeAddress)
    log(`Chainlink Oracle permission for ${chainlinkNodeAddress} is ${permission}`)

    const ensCacheFactory = await getContractFactory("ENSCache", wallet)
    const ensCacheFactoryTx = await ensCacheFactory.deploy(oracle.address, chainlinkJobId)
    const ensCache = await ensCacheFactoryTx.deployed()
    log(`ENSCache deployed at ${ensCache.address}`)
    log(`ENSCache setting Link token address ${linkToken.address}`)
    const setPermissionTx = await ensCache.setChainlinkTokenAddress(linkToken.address)
    await setPermissionTx.wait()

    log('Sending some Link to ENSCache')
    const transfertx = await linkToken.transfer(ensCache.address, parseEther('1000')) // 1000 link
    await transfertx.wait()

    log(`Deploying NodeRegistry contract 2 (storage node registry) to sidechain from ${wallet.address}`)
    const initialNodes = []
    const initialMetadata = []
    initialNodes.push('0xde1112f631486CfC759A50196853011528bC5FA0')
    initialMetadata.push('{"http": "http://10.200.10.1:8891"}')
    const strDeploy = await getContractFactory("NodeRegistry", wallet)
    // const strDeploy = await getContractFactory('NodeRegistry')
    const strDeployTx = await upgrades.deployProxy(strDeploy,
        [wallet.address, false, initialNodes, initialMetadata], { kind: 'uups' })
    // const strDeployTx = await strDeploy.deploy(sidechainWalletStreamReg.address, false, initialNodes, initialMetadata, {gasLimit: 6000000} )
    const nodeRegistry = await strDeployTx.deployed()
    log(`NodeRegistry deployed at ${nodeRegistry.address}`)
    const nodes = await nodeRegistry.getNodes()
    log(`NodeRegistry nodes: ${JSON.stringify(nodes)}`)

    const trustedForwarderAddress = computeAddress('0x000000000000000000000000000000000000000000000000000000000000000a')
    const streamRegistryFactory = await getContractFactory("StreamRegistryV4", wallet)
    const streamRegistryFactoryTx = await upgrades.deployProxy(streamRegistryFactory, [ensCache.address, trustedForwarderAddress], {
        kind: 'uups'
    })
    const streamRegistry = await streamRegistryFactoryTx.deployed()
    log(`StreamregistryV4 deployed at ${streamRegistry.address}`)

    log(`setting Streamregistry address in ENSCache`)
    const setStreamRegTx = await ensCache.setStreamRegistry(streamRegistry.address)
    await setStreamRegTx.wait()
    log(`setting enscache address as trusted role in streamregistry`)

    const ensa = ensCache.address
    const role = await streamRegistry.TRUSTED_ROLE()
    log(`granting role ${role} ensaddress ${ensa}`)
    const grantRoleTx = await streamRegistry.grantRole(role, ensa)
    await grantRoleTx.wait()

    const storageNodePk = '0xaa7a3b3bb9b4a662e756e978ad8c6464412e7eef1b871f19e5120d4747bce966'
    const storageNodeWallet = new Wallet(storageNodePk, new JsonRpcProvider(sidechainURL))
    const streamRegistry2 = streamRegistry.connect(storageNodeWallet)

    log('Create storage node assignment stream')
    const storageNodeAssignmentPath = '/assignments'
    const storageNodeAssignmentsStreamId = '0xde1112f631486cfc759a50196853011528bc5fa0/assignments'
    const tx1 = await streamRegistry2.createStream(storageNodeAssignmentPath, JSON.stringify({ partitions: 1}), { gasLimit: 5999990 })
    await tx1.wait()
    const tx2 = await streamRegistry2.setPublicPermission(storageNodeAssignmentsStreamId, MaxUint256, MaxUint256, { gasLimit: 5999990 })
    await tx2.wait()

    return {
        nodeRegistry,
        streamRegistry,
        linkToken,
        ensCache
    }
}

async function deploySponsorshipFactory(wallet, token, streamRegistry) {
    const signer = wallet
    const streamrConstantsFactory = await getContractFactory("StreamrConfig", { signer })
    const streamrConstantsFactoryTx = await upgrades.deployProxy(streamrConstantsFactory, [], { kind: "uups" })
    const streamrConfig = await streamrConstantsFactoryTx.deployed()
    const hasroleEthSigner = await streamrConfig.hasRole(await streamrConfig.DEFAULT_ADMIN_ROLE(), wallet.address)
    log(`${wallet.address} hasrole DEFAULT_ADMIN_ROLE: ${hasroleEthSigner}`)
    log(`streamrConfig address ${streamrConfig.address}`)

    const maxOperatorsJoinPolicy = await (await getContractFactory("MaxOperatorsJoinPolicy", { signer })).deploy()
    await maxOperatorsJoinPolicy.deployed()
    log(`maxOperatorsJoinPolicy address ${maxOperatorsJoinPolicy.address}`)

    const allocationPolicy = await (await getContractFactory("StakeWeightedAllocationPolicy", { signer })).deploy()
    await allocationPolicy.deployed()
    log(`allocationPolicy address ${allocationPolicy.address}`)

    const leavePolicy = await (await getContractFactory("DefaultLeavePolicy", { signer })).deploy()
    await leavePolicy.deployed()
    log(`leavePolicy address ${leavePolicy.address}`)

    const voteKickPolicy = await (await getContractFactory("VoteKickPolicy", { signer })).deploy()
    await voteKickPolicy.deployed()
    log(`voteKickPolicy address ${voteKickPolicy.address}`)

    const operatorContractOnlyJoinPolicy =
        await (await getContractFactory("OperatorContractOnlyJoinPolicy", { signer })).deploy()
    await operatorContractOnlyJoinPolicy.deployed()
    log(`operatorContractOnlyJoinPolicy address ${operatorContractOnlyJoinPolicy.address}`)

    const sponsorshipTemplate = await (await getContractFactory("Sponsorship", { signer })).deploy()
    await sponsorshipTemplate.deployed()
    log(`sponsorshipTemplate address ${sponsorshipTemplate.address}`)

    const sponsorshipFactoryFactory = await getContractFactory("SponsorshipFactory", { signer })
    const sponsorshipFactoryFactoryTx = await upgrades.deployProxy(sponsorshipFactoryFactory, [
        sponsorshipTemplate.address,
        token.address,
        streamrConfig.address
    ], {  unsafeAllow: ['delegatecall'], kind: "uups" })
    const sponsorshipFactory = await sponsorshipFactoryFactoryTx.deployed()
    await (await sponsorshipFactory.addTrustedPolicies([
        allocationPolicy.address,
        leavePolicy.address,
        voteKickPolicy.address,
        maxOperatorsJoinPolicy.address,
        operatorContractOnlyJoinPolicy.address,
    ])).wait()

    await (await streamrConfig.setSponsorshipFactory(sponsorshipFactory.address)).wait()
    log(`sponsorshipFactory address ${sponsorshipFactory.address}`)

    // const transfertx = await token.transfer(wallet.address, parseEther('1000')) // 1000 link
    // await transfertx.wait()
    // log(`transferred 1000 link to ${wallet.address}`)
    // await (await token.mint(wallet.address, parseEther("1000000"))).wait()
    // log(`minted 1000000 datatokens to ${wallet.address}`)
    // await (await token.mint(dataTokenOwner.address, parseEther("1000000"))).wait()
    // log(`minted 1000000 datatokens to ${dataTokenOwner.address}`)
    // await (await dataToken.connect(dataTokenOwner).mint(operatorWallet.address, parseEther("100000"))).wait()
    // log(`transferred 100000 datatokens to ${operatorWallet.address}`)
    // await (await wallet.sendTransaction({ to: operatorWallet.address, value: parseEther("1") })).wait()
    // log(`transferred 1 ETH to ${operatorWallet.address}`)

    await (await streamRegistry.createStream('/test', JSON.stringify({ partitions: 1}), { gasLimit: 5999990 })).wait()
    const streamId = streamRegistry.signer.address.toLowerCase() + '/test'

    // stream registry must be set in config before sponsorship is deployed because it checks if stream exists
    await (await streamrConfig.setStreamRegistryAddress(streamRegistry.address)).wait()

    const agreementtx = await sponsorshipFactory.deploySponsorship(parseEther("100"), 0, 1, streamId,
        '{ "metadata": "test"}',
        [
            allocationPolicy.address,
            AddressZero,
            voteKickPolicy.address,
        ], [
            parseEther("0.01"),
            "0",
            "0"
        ]
    )
    const agreementReceipt = await agreementtx.wait()
    const newSponsorshipAddress = agreementReceipt.events?.filter((e) => e.event === "NewSponsorship")[0]?.args?.sponsorshipContract
    log("new sponsorship address: " + newSponsorshipAddress)

    const sponsorshipEthersFactory = await getContractFactory("Sponsorship", { signer })
    const sponsorship = await sponsorshipEthersFactory.attach(newSponsorshipAddress)
    log("Sponsorship deployed at " + sponsorship.address)
    const hasrole = await sponsorship.hasRole(await sponsorship.DEFAULT_ADMIN_ROLE(), wallet.address)
    log(`adminwallet ${wallet.address} hasrole sponsorship.DEFAULT_ADMIN_ROLE: ${hasrole}`)
    const adminWalletBalance = await token.balanceOf(wallet.address)
    log("adminWalletBalance: " + adminWalletBalance.toString())
    await (await token.connect(wallet).approve(newSponsorshipAddress, parseEther("20"))).wait()
    const allowance = await token.allowance(wallet.address, newSponsorshipAddress)
    log("allowance: " + allowance.toString())
    const sponsorTx = await sponsorship.sponsor(parseEther("20"))
    await sponsorTx.wait()
    // log("sponsored through token approval")

    // const tx = await token.connect(wallet).transferAndCall(newSponsorshipAddress, parseEther("1"),
    //     wallet.address)
    // await tx.wait()
    // log("staked in sponsorship with transfer and call")

    const operatorTemplate = await (await getContractFactory("Operator")).deploy()
    await operatorTemplate.deployed()
    log("Deployed operator template", operatorTemplate.address)
    const defaultDelegationPolicy = await (await getContractFactory("DefaultDelegationPolicy",
        { signer })).deploy()
    await defaultDelegationPolicy.deployed()
    log("Deployed default operator join policy", defaultDelegationPolicy.address)
    const defaultPoolYieldPolicy = await (await getContractFactory("DefaultPoolYieldPolicy",
        { signer })).deploy()
    await defaultPoolYieldPolicy.deployed()
    log("Deployed default operator yield policy", defaultPoolYieldPolicy.address)
    const defaultUndelegationPolicy = await (await getContractFactory("DefaultUndelegationPolicy",
        { signer })).deploy()
    await defaultUndelegationPolicy.deployed()
    log("Deployed default operator exit policy", defaultUndelegationPolicy.address)

    const operatorFactoryFactory = await getContractFactory("OperatorFactory",
        { signer })
    const operatorFactory = await upgrades.deployProxy(operatorFactoryFactory, [
        operatorTemplate.address,
        token.address,
        streamrConfig.address
    ], {  unsafeAllow: ['delegatecall'], kind: "uups" })
    // eslint-disable-next-line require-atomic-updates
    // localConfig.operatorFactory = operatorFactory.address
    await operatorFactory.deployed()
    log("Deployed operator factory", operatorFactory.address)
    // eslint-disable-next-line require-atomic-updates
    await (await operatorFactory.addTrustedPolicies([
        defaultDelegationPolicy.address,
        defaultPoolYieldPolicy.address,
        defaultUndelegationPolicy.address,
    ])).wait()
    log("Added trusted policies")
    await (await streamrConfig.setOperatorFactory(operatorFactory.address)).wait()
    log("Set operator operator factory in StreamrConfig")

    const operatortx = await operatorFactory.connect(wallet).deployOperator(
        [`Operator-${Date.now()}`, "{}"],
        [defaultDelegationPolicy.address,
            defaultPoolYieldPolicy.address,
            defaultUndelegationPolicy.address],
        [0, 0, 0, 0, 0, parseEther("0.1")]
    )
    const operatorReceipt = await operatortx.wait()
    const operatorAddress = operatorReceipt.events?.find((e) => e.event === "NewOperator")?.args?.operatorContractAddress
    log("Operator deployed at: ", operatorAddress)
    // eslint-disable-next-line require-atomic-updates
    const operatorFactory2 = await getContractFactory("Operator", { signer })
    const operator = await operatorFactory2.attach(operatorAddress)
    const delegateTx = await token.connect(wallet).transferAndCall(
        operator.address,
        parseEther("1000"),
        wallet.address
    )
    await delegateTx.wait()
    log("Delegated to operator ", operator.address)
    const stakeTx = await operator.connect(wallet).stake(sponsorship.address, parseEther("1000"))
    await stakeTx.wait()
    log("Staked into sponsorship ", sponsorship.address)

    return {
        "SponsorshipFactory": sponsorshipFactory.address,
        "OperatorFactory": operatorFactory.address,
        "StreamrConfig": streamrConfig.address,
        "MaxOperatorsJoinPolicy": maxOperatorsJoinPolicy.address,
        "StakeWeightedAllocationPolicy": allocationPolicy.address,
        "DefaultLeavePolicy": leavePolicy.address,
        "VoteKickPolicy": voteKickPolicy.address,
        "DefaultDelegationPolicy": defaultDelegationPolicy.address,
        "DefaultPoolYieldPolicy": defaultPoolYieldPolicy.address,
        "DefaultUndelegationPolicy": defaultUndelegationPolicy.address,
    }
}

async function deployENSCacheV2(wallet, streamRegistry, ensCache) {
    const ensCacheScriptFactory = await getContractFactory("ENSCacheV2Streamr", wallet)
    const scriptKeyAddress = "0xa3d1F77ACfF0060F7213D7BF3c7fEC78df847De1"
    const ensCacheScript = await upgrades.deployProxy(ensCacheScriptFactory, [
        scriptKeyAddress,
        streamRegistry.address,
        ensCache.address,
    ], { kind: "uups" })
    await ensCacheScript.deployed()

    log("ENSCacheV2 (chainlinkless) deployed at:", ensCacheScript.address)

    log("Signer: %s", streamRegistry.signer.address)

    const role = await streamRegistry.TRUSTED_ROLE()
    log(`granting trusted role ${role} to self ${wallet.address}`)
    await (await streamRegistry.grantRole(role, wallet.address)).wait()

    log("setting ENSCache address in StreamRegistry")
    await (await streamRegistry.connect(wallet).setEnsCache(ensCacheScript.address)).wait()

    log(`granting trusted role ${role} ensaddress ${ensCacheScript.address}`)
    await (await streamRegistry.grantRole(role, ensCacheScript.address)).wait()
    log("ensCacheScript address set as trusted role in streamregistry")
}

main().catch(console.error)
