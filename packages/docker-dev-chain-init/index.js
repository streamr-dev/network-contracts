const fs = require("fs")
const Web3 = require("web3")
const { ethers, upgrades } = require('hardhat')
const {
    Contract,
    ContractFactory,
    utils: {computeAddress, parseEther, formatEther, namehash, id, bigNumberify},
    constants: {MaxUint256},
    Wallet,
    providers: {JsonRpcProvider}
} = require("ethers4")

const TestTokenJson = require("./ethereumContractJSONs/TestToken.json")
const OldTokenJson = require("./ethereumContractJSONs/CrowdsaleToken.json")
const MarketplaceJson = require("./ethereumContractJSONs/Marketplace.json")
const Marketplace2Json = require("./ethereumContractJSONs/Marketplace2.json")
const UniswapAdaptor = require("./ethereumContractJSONs/UniswapAdaptor.json")
const Uniswap2Adapter = require("./ethereumContractJSONs/Uniswap2Adapter.json")
const NodeRegistry = require("./ethereumContractJSONs/NodeRegistry.json")
const ENSRegistry = require("./ethereumContractJSONs/ENSRegistry.json")
const FIFSRegistrar = require("./ethereumContractJSONs/FIFSRegistrar.json")
const PublicResolver = require("./ethereumContractJSONs/PublicResolver.json")
const DATAv2 = require("./ethereumContractJSONs/DATAv2.json")
const DataTokenMigrator = require("./ethereumContractJSONs/DataTokenMigrator.json")
const BinanceAdapter = require("./ethereumContractJSONs/BinanceAdapter.json")

//Uniswap v2
const UniswapV2Factory = require("../../node_modules/@uniswap/v2-core/build/UniswapV2Factory.json")
const UniswapV2Router02 = require("../../node_modules/@uniswap/v2-periphery/build/UniswapV2Router02.json")
// const ExampleSlidingWindowOracle = require("../../node_modules/@uniswap/v2-periphery/build/ExampleSlidingWindowOracle.json");

const WETH9 = require("../../node_modules/@uniswap/v2-periphery/build/WETH9.json")

//Uniswap v1
const uniswap_exchange_abi = JSON.parse(fs.readFileSync("./abi/uniswap_exchange.json", "utf-8"))
const uniswap_factory_abi = JSON.parse(fs.readFileSync("./abi/uniswap_factory.json", "utf-8"))
const uniswap_exchange_bytecode = fs.readFileSync("./bytecode/uniswap_exchange.txt", "utf-8")
const uniswap_factory_bytecode = fs.readFileSync("./bytecode/uniswap_factory.txt", "utf-8")

// Streamregistry
const LinkToken = require('./ethereumContractJSONs/LinkToken.json')
const ChainlinkOracle = require('./ethereumContractJSONs/Oracle.json')
// // const ENSCache = require('./ethereumContractJSONs/ENSCache.json')
// const StreamRegistry = require('./ethereumContractJSONs/StreamRegistry.json')

// const StreamStorageRegistry = require('./ethereumContractJSONs/StreamStorageRegistry.json')

const products = require('./products.json')
const projectsData = require('./projectsData.json')

const chainURL = process.env.CHAIN_URL || "http://10.200.10.1:8545"
const sidechainURL = process.env.SIDECHAIN_URL || "http://10.200.10.1:8546"

// const streamrUrl = process.env.EE_URL || "http://10.200.10.1:8081/streamr-core" // production: "https://www.streamr.com"
const log = require("debug")("eth-init")
const futureTime = 4449513600

// DATAv1 token supply before the upgrade (real mainnet number)
// See totalSupply at https://etherscan.io/address/0x0cf0ee63788a0849fe5297f3407f701e122cc023#readContract
const oldSupply = parseEther("987154514")

// how much to mint to each of the privateKeys
const mintTokenAmount = parseEther("1000000")

// this wallet will deploy all contracts and "own" them if applicable
const defaultPrivateKey = "0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0"
const privKeyStreamRegistry = "0x4059de411f15511a85ce332e7a428f36492ab4e87c7830099dadbf130f1896ae"

// "testrpc" mnemonic wallets, will have DATAv1 and DATAv2 tokens in them
const privateKeys = [
    "0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0", // used!!
    "0xe5af7834455b7239881b85be89d905d6881dcb4751063897f12be1b0dd546bdb", // used!!
    "0x4059de411f15511a85ce332e7a428f36492ab4e87c7830099dadbf130f1896ae", // used!!
    "0x633a182fb8975f22aaad41e9008cb49a432e9fdfef37f151e9e7c54e96258ef9", // use this for new deployments
    "0x957a8212980a9a39bf7c03dcbeea3c722d66f2b359c669feceb0e3ba8209a297",
    "0xfe1d528b7e204a5bdfb7668a1ed3adfee45b4b96960a175c9ef0ad16dd58d728",
    "0xd7609ae3a29375768fac8bc0f8c2f6ac81c5f2ffca2b981e6cf15460f01efe14",
    "0xb1abdb742d3924a45b0a54f780f0f21b9d9283b231a0a0b35ce5e455fa5375e7",
    "0x2cd9855d17e01ce041953829398af7e48b24ece04ff9d0e183414de54dc52285",
]

// single-use wallets for tests, listed projects' wallets have DATAv2 tokens on them
// [ "project-name", testWalletCount ]
const projects = [
    ["js-client", 100],
    ["java-client", 20],
    ["marketplace-contracts", 10],
    ["network-contracts", 10],
    ["data-union-contracts", 10],
    ["operator", 10],
    ["network", 100],
    ["core-api", 10],
    ["core-frontend", 10],
    ["...add your own here", 1],
]
function getTestWallet(name, index) {
    const hash = id(name + (index || ""))
    return new Wallet(hash)
}

// these come from the next step, but we can predict the addresses
const sidechainDataCoin = '0x73Be21733CC5D08e1a14Ea9a399fb27DB3BEf8fF'
const sidechainSingleTokenMediator = '0xedD2aa644a6843F2e5133Fe3d6BD3F4080d97D9F'
const chainlinkNodeAddress = '0x7b5F1610920d5BAf00D684929272213BaF962eFe'
const chainlinkJobId = 'c99333d032ed4cb8967b956c7f0329b5'
let nodeRegistryAddress = ''
let streamRegistryAddress = ''
let ensCachV1Address = ''
let streamRegistryFromOwner
let linkToken

async function getProducts() {
    // return await (await fetch(`${streamrUrl}/api/v1/products?publicAccess=true`)).json()
    return products
}

// function sleep(ms) {
//     return new Promise(resolve => {
//         setTimeout(resolve, ms)
//     })
// }

// AutoNonceWallet allows for omitting .wait()ing for the transactions as long as no reads are done
// from https://github.com/ethers-io/ethers.js/issues/319
class AutoNonceWallet extends Wallet {
    noncePromise = null
    sendTransaction(transaction) {
        if (transaction.nonce == null) {
            if (this.noncePromise == null) {
                this.noncePromise = this.provider.getTransactionCount(this.address)
            }
            transaction.nonce = this.noncePromise
            this.noncePromise = this.noncePromise.then((nonce) => (nonce + 1))
        }
        return super.sendTransaction(transaction)
    }
}

/**
 *
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

async function deployNodeRegistry(wallet, initialNodes, initialMetadata) {
    const strDeploy = new ContractFactory(NodeRegistry.abi, NodeRegistry.bytecode, wallet)
    const strDeployTx = await strDeploy.deploy(wallet.address, false, initialNodes, initialMetadata, {gasLimit: 6000000} )
    const str = await strDeployTx.deployed()
    nodeRegistryAddress = str.address
    log(`NodeRegistry deployed at ${str.address}`)
    let nodes = await str.getNodes()
    log(`NodeRegistry nodes : ${JSON.stringify(nodes)}`)
}

async function deployStreamStorageRegistry(wallet) {
    const strDeploy = await ethers.getContractFactory("StreamStorageRegistryV2", wallet)
    // const strDeployTx = await strDeploy.deploy(streamRegistryAddress, nodeRegistryAddress, wallet.address, {gasLimit: 6000000} )
    const strDeployTx = await upgrades.deployProxy(strDeploy, [streamRegistryAddress, nodeRegistryAddress, ethers.constants.AddressZero], {
        kind: 'uups'
    })
    const str = await strDeployTx.deployed()
    log(`StreamStorageRegistryV2 deployed at ${str.address}`)
}

async function deployProjectRegistryV1(wallet) {
    const projectRegistryFactory = await ethers.getContractFactory("ProjectRegistryV1", wallet)
    const projectRegistryFactoryTx = await upgrades.deployProxy(projectRegistryFactory, [streamRegistryAddress], { kind: 'uups' })
    const projectRegistry = await projectRegistryFactoryTx.deployed()
    log(`ProjectRegistry deployed at ${projectRegistry.address}`)
    return projectRegistry
}

async function deployProjectStakingV1(wallet, projectRegistryAddress, tokenStakingAddress) {
    const projectStakingV1Factory = await ethers.getContractFactory("ProjectStakingV1", wallet)
    const projectStakingV1FactoryTx = await upgrades.deployProxy(projectStakingV1Factory, [
        projectRegistryAddress,
        tokenStakingAddress
    ], { kind: 'uups' })
    const projectStakingV1 = await projectStakingV1FactoryTx.deployed()
    log(`ProjectStakingV1 deployed at ${projectStakingV1.address}`)
    return projectStakingV1
}

async function deployMarketplaceV3(wallet) {
    const marketplaceV3Factory = await ethers.getContractFactory("MarketplaceV3", wallet)
    const marketplaceV3FactoryTx = await upgrades.deployProxy(marketplaceV3Factory, [], { kind: 'uups' })
    const marketplaceV3 = await marketplaceV3FactoryTx.deployed()
    log(`MarketplaceV3 deployed on sidechain at ${marketplaceV3.address}`)
    return marketplaceV3
}

async function deployMarketplaceV4(wallet, projectRegistryAddress, destinationChainId) {
    const marketplaceV4Factory = await ethers.getContractFactory("MarketplaceV4", wallet)
    const marketplaceV4FactoryTx = await upgrades.deployProxy(marketplaceV4Factory, [projectRegistryAddress, destinationChainId], { kind: 'uups' })
    const marketplaceV4 = await marketplaceV4FactoryTx.deployed()
    log(`MarketplaceV4 deployed on sidechain at ${marketplaceV4.address}`)
    return marketplaceV4
}

async function deployUniswap2(wallet) {
    let deployer = new ContractFactory(WETH9.abi, WETH9.bytecode, wallet)
    let tx = await deployer.deploy()
    const weth = await tx.deployed()
    log(`WETH deployed to ${weth.address}`)

    deployer = new ContractFactory(UniswapV2Factory.abi, UniswapV2Factory.bytecode, wallet)
    tx = await deployer.deploy(wallet.address)
    const factory = await tx.deployed()
    log(`Uniswap2 factory deployed to ${factory.address}`)

    deployer = new ContractFactory(UniswapV2Router02.abi, UniswapV2Router02.bytecode, wallet)
    tx = await deployer.deploy(factory.address, weth.address)
    const router = await tx.deployed()
    log(`Uniswap2 router deployed to ${router.address}`)
    return router
}

async function ethersWallet(url, privateKey) {
    let provider = new JsonRpcProvider(url)
    try {
        await provider.getNetwork()
    } catch (e) {
        console.error(e)
        process.exit(1)
    }
    return new AutoNonceWallet(privateKey, provider)
}

async function deployStreamRegistries() {
    const sidechainWalletStreamReg = await ethersWallet(sidechainURL, privKeyStreamRegistry)

    log('Sending some Ether to chainlink node address')
    await sidechainWalletStreamReg.sendTransaction({
        to: chainlinkNodeAddress,
        value: parseEther('100')
    })

    log('Deploying Streamregistry and chainlink contracts to sidechain:')
    const linkTokenFactory = new ContractFactory(LinkToken.abi, LinkToken.bytecode, sidechainWalletStreamReg)
    const linkTokenFactoryTx = await linkTokenFactory.deploy()
    linkToken = await linkTokenFactoryTx.deployed()
    log(`Link Token deployed at ${linkToken.address}`)

    const oracleFactory = new ContractFactory(ChainlinkOracle.compilerOutput.abi,
        ChainlinkOracle.compilerOutput.evm.bytecode.object, sidechainWalletStreamReg)
    const oracleFactoryTx = await oracleFactory.deploy(linkToken.address)
    const oracle = await oracleFactoryTx.deployed()
    log(`Chainlink Oracle deployed at ${oracle.address}`)
    const tokenaddrFromOracle = await oracle.getChainlinkToken()
    log(`Chainlink Oracle token pointing to ${tokenaddrFromOracle}`)
    const fulfilmentPermissionTX = await oracle.setFulfillmentPermission(chainlinkNodeAddress, true)
    await fulfilmentPermissionTX.wait()
    const permission = await oracle.getAuthorizationStatus(chainlinkNodeAddress)
    log(`Chainlink Oracle permission for ${chainlinkNodeAddress} is ${permission}`)

    const ensCacheFactory = await ethers.getContractFactory("ENSCache", sidechainWalletStreamReg)
    const ensCacheFactoryTx = await ensCacheFactory.deploy(oracle.address, chainlinkJobId)
    const ensCache = await ensCacheFactoryTx.deployed()
    ensCachV1Address = ensCache.address
    log(`ENSCache deployed at ${ensCache.address}`)
    log(`ENSCache setting Link token address ${linkToken.address}`)
    const setPermissionTx = await ensCache.setChainlinkTokenAddress(linkToken.address)
    await setPermissionTx.wait()

    log('Sending some Link to ENSCache')
    const transfertx = await linkToken.transfer(ensCache.address, bigNumberify('1000000000000000000000')) // 1000 link
    await transfertx.wait()

    const wallet1 = new Wallet('0x000000000000000000000000000000000000000000000000000000000000000a')

    log(`Deploying NodeRegistry contract 2 (storage node registry) to sidechain from ${sidechainWalletStreamReg.address}`)
    initialNodes = []
    initialMetadata = []
    initialNodes.push('0xde1112f631486CfC759A50196853011528bC5FA0')
    initialMetadata.push('{"http": "http://10.200.10.1:8891"}')
    const strDeploy = await ethers.getContractFactory("NodeRegistry", sidechainWalletStreamReg)
    // const strDeploy = await ethers.getContractFactory('NodeRegistry')
    const strDeployTx = await upgrades.deployProxy(strDeploy,
        [sidechainWalletStreamReg.address, false, initialNodes, initialMetadata], { kind: 'uups' })
    // const strDeployTx = await strDeploy.deploy(sidechainWalletStreamReg.address, false, initialNodes, initialMetadata, {gasLimit: 6000000} )
    const nodeRegDeployed = await strDeployTx.deployed()
    nodeRegistryAddress = nodeRegDeployed.address
    log(`NodeRegistry deployed at ${nodeRegDeployed.address}`)
    let nodes = await nodeRegDeployed.getNodes()
    log(`NodeRegistry nodes : ${JSON.stringify(nodes)}`)

    const streamRegistryFactory = await ethers.getContractFactory("StreamRegistryV4", sidechainWalletStreamReg)
    const streamRegistryFactoryTx = await upgrades.deployProxy(streamRegistryFactory, [ensCache.address, wallet1.address], {
        kind: 'uups'
    })
    const streamRegistry = await streamRegistryFactoryTx.deployed()
    streamRegistryFromOwner = streamRegistry
    streamRegistryAddress = streamRegistry.address
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
    const storageNodeWallet = new ethers.Wallet(storageNodePk, new ethers.providers.JsonRpcProvider(sidechainURL))
    const streamRegistry2 = streamRegistry.connect(storageNodeWallet)

    log('Create storage node assignment stream')
    const storageNodeAssignmentPath = '/assignments'
    const storageNodeAssignmentsStreamId = '0xde1112f631486cfc759a50196853011528bc5fa0/assignments'
    const tx1 = await streamRegistry2.createStream(storageNodeAssignmentPath, JSON.stringify({ partitions: 1}), { gasLimit: 5999990 })
    await tx1.wait()
    const tx2 = await streamRegistry2.setPublicPermission(storageNodeAssignmentsStreamId, MaxUint256, MaxUint256, { gasLimit: 5999990 })
    await tx2.wait()

}

async function deploySponsorshipFactory() {
    const adminWalletEthers4 = await ethersWallet(sidechainURL, privKeyStreamRegistry)
    const adminWallet = new ethers.Wallet(privKeyStreamRegistry, new ethers.providers.JsonRpcProvider(sidechainURL))
    const streamrConstantsFactory = await ethers.getContractFactory("StreamrConfig", { signer: adminWallet })
    const streamrConstantsFactoryTx = await upgrades.deployProxy(streamrConstantsFactory, [], { kind: "uups" })
    const streamrConfig = await streamrConstantsFactoryTx.deployed()
    const hasroleEthSigner = await streamrConfig.hasRole(await streamrConfig.DEFAULT_ADMIN_ROLE(), adminWallet.address)
    log(`hasrole adminwallet ${hasroleEthSigner}`)
    log(`streamrConfig address ${streamrConfig.address}`)

    const maxOperatorsJoinPolicy = await (await ethers.getContractFactory("MaxOperatorsJoinPolicy")).deploy()
    await maxOperatorsJoinPolicy.deployed()
    log(`maxOperatorsJoinPolicy address ${maxOperatorsJoinPolicy.address}`)

    const allocationPolicy = await (await ethers.getContractFactory("StakeWeightedAllocationPolicy")).deploy()
    await allocationPolicy.deployed()
    log(`allocationPolicy address ${allocationPolicy.address}`)

    const leavePolicy = await (await ethers.getContractFactory("DefaultLeavePolicy")).deploy()
    await leavePolicy.deployed()
    log(`leavePolicy address ${leavePolicy.address}`)

    const voteKickPolicy = await (await ethers.getContractFactory("VoteKickPolicy")).deploy()
    await voteKickPolicy.deployed()
    log(`voteKickPolicy address ${voteKickPolicy.address}`)

    const sponsorshipTemplate = await (await ethers.getContractFactory("Sponsorship")).deploy()
    await sponsorshipTemplate.deployed()
    log(`sponsorshipTemplate address ${sponsorshipTemplate.address}`)

    const sponsorshipFactoryFactory = await ethers.getContractFactory("SponsorshipFactory", { signer: adminWallet })
    const sponsorshipFactoryFactoryTx = await upgrades.deployProxy(sponsorshipFactoryFactory,
        [ sponsorshipTemplate.address, linkToken.address, streamrConfig.address ], {  unsafeAllow: ['delegatecall'], kind: "uups" })
    const sponsorshipFactory = await sponsorshipFactoryFactoryTx.deployed()
    await (await sponsorshipFactory.addTrustedPolicies([maxOperatorsJoinPolicy.address,
        allocationPolicy.address, leavePolicy.address, voteKickPolicy.address])).wait()

    await (await streamrConfig.setSponsorshipFactory(sponsorshipFactory.address)).wait()
    log(`sponsorshipFactory address ${sponsorshipFactory.address}`)

    // const transfertx = await linkToken.transfer(adminWallet.address, bigNumberify('10000000000000000000000')) // 1000 link
    // await transfertx.wait()
    // log(`transferred 1000 link to ${adminWallet.address}`)
    // await (await linkToken.mint(adminWallet.address, ethers.utils.parseEther("1000000"))).wait()
    // log(`minted 1000000 datatokens to ${adminWallet.address}`)
    // await (await linkToken.mint(dataTokenOwner.address, ethers.utils.parseEther("1000000"))).wait()
    // log(`minted 1000000 datatokens to ${dataTokenOwner.address}`)
    // await (await dataToken.connect(dataTokenOwner).mint(operatorWallet.address, ethers.utils.parseEther("100000"))).wait()
    // log(`transferred 100000 datatokens to ${operatorWallet.address}`)
    // await (await adminWallet.sendTransaction({ to: operatorWallet.address, value: ethers.utils.parseEther("1") })).wait()
    // log(`transferred 1 ETH to ${operatorWallet.address}`)
    const agreementtx = await sponsorshipFactory.deploySponsorship(ethers.utils.parseEther("100"), 0, 1, "Sponsorship-" + Date.now(),
        '{ "metadata": "test"}',
        [
            allocationPolicy.address,
            ethers.constants.AddressZero,
            voteKickPolicy.address,
        ], [
            ethers.utils.parseEther("0.01"),
            "0",
            "0"
        ]
    )
    const agreementReceipt = await agreementtx.wait()
    const newSponsorshipAddress = agreementReceipt.events?.filter((e) => e.event === "NewSponsorship")[0]?.args?.sponsorshipContract
    log("new sponsorship address: " + newSponsorshipAddress)

    // sponsorship = await ethers.getContractAt("Sponsorship", newSponsorshipAddress, adminWallet)
    const sponsorshipEthersFactory = await ethers.getContractFactory("Sponsorship", { signer: adminWallet })
    const sponsorship = await sponsorshipEthersFactory.attach(newSponsorshipAddress)
    const hasrole = await sponsorship.hasRole(await sponsorship.DEFAULT_ADMIN_ROLE(), adminWallet.address)
    log(`hasrole sponsorship adminwallet ${hasrole}`)
    log(`adminwallet ${adminWallet.address}`)
    // sponsorship = await sponsorshipEFContrac.connect(adminWallet)
    // sponsor with token approval
    // const ownerbalance = await tokenFromOwner.balanceOf(deploymentOwner.address)
    const adminWalletBalance = await linkToken.balanceOf(adminWallet.address)
    log("adminWalletBalance: " + adminWalletBalance.toString())
    await (await linkToken.connect(adminWalletEthers4).approve(newSponsorshipAddress, ethers.utils.parseEther("20"))).wait()
    const allowance = await linkToken.allowance(adminWallet.address, newSponsorshipAddress)
    log("allowance: " + allowance.toString())
    // const tokenOwnerBalance = await dataToken.balanceOf(dataTokenOwner.address)
    // log("tokenOwnerBalance: " + tokenOwnerBalance.toString())
    // await (await dataToken.approve(newSponsorshipAddress, ethers.utils.parseEther("7"))).wait()
    // const allowance2 = await dataToken.allowance(dataTokenOwner.address, newSponsorshipAddress)
    // log("allowance2: " + allowance2.toString())
    const sponsorTx = await sponsorship.sponsor(ethers.utils.parseEther("20"))
    await sponsorTx.wait()
    log("sponsored through token approval")

    // const tx = await linkToken.connect(adminWalletEthers4).transferAndCall(newSponsorshipAddress, ethers.utils.parseEther("1"),
    //     adminWallet.address)
    // await tx.wait()
    // log("staked in sponsorship with transfer and call")

    const operatorTemplate = await (await ethers.getContractFactory("Operator")).deploy()
    await operatorTemplate.deployed()
    log("Deployed operator template", operatorTemplate.address)
    const defaultDelegationPolicy = await (await ethers.getContractFactory("DefaultDelegationPolicy",
        { signer: adminWallet })).deploy()
    await defaultDelegationPolicy.deployed()
    log("Deployed default operator join policy", defaultDelegationPolicy.address)
    const defaultPoolYieldPolicy = await (await ethers.getContractFactory("DefaultPoolYieldPolicy",
        { signer: adminWallet })).deploy()
    await defaultPoolYieldPolicy.deployed()
    log("Deployed default operator yield policy", defaultPoolYieldPolicy.address)
    const defaultUndelegationPolicy = await (await ethers.getContractFactory("DefaultUndelegationPolicy",
        { signer: adminWallet })).deploy()
    await defaultUndelegationPolicy.deployed()
    log("Deployed default operator exit policy", defaultUndelegationPolicy.address)

    const operatorFactoryFactory = await ethers.getContractFactory("OperatorFactory",
        { signer: adminWallet })
    const operatorFactory = await upgrades.deployProxy(operatorFactoryFactory, [
        operatorTemplate.address,
        linkToken.address,
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
    await (await streamrConfig.setStreamRegistryAddress(streamRegistryAddress)).wait()
    await (await streamrConfig.setOperatorFactory(operatorFactory.address)).wait()
    log("Set operator operator factory in StreamrConfig")

    const operatortx = await operatorFactory.connect(adminWallet).deployOperator(
        [`Operator-${Date.now()}`, "{}"],
        [defaultDelegationPolicy.address,
            defaultPoolYieldPolicy.address,
            defaultUndelegationPolicy.address],
        [0, 0, 0, 0, 0, parseEther("0.1")]
    )
    const operatorReceipt = await operatortx.wait()
    const operatorAddress = operatorReceipt.events?.find((e) => e.event === "NewOperator")?.args?.operatorContractAddress
    // eslint-disable-next-line require-atomic-updates
    log("Operator deployed at: ", operatorAddress)
    const operatorFactory2 = await ethers.getContractFactory("Operator", { signer: adminWallet })
    const operator = await operatorFactory2.attach(operatorAddress)
    const investTx = await linkToken.connect(adminWalletEthers4).transferAndCall(operator.address, ethers.utils.parseEther("1000"),
        adminWallet.address, { nonce: await adminWallet.getTransactionCount()})
    await investTx.wait()
    log("Invested to operator ", operator.address)
    const stakeTx = await operator.connect(adminWallet).stake(sponsorship.address, ethers.utils.parseEther("1000"))
    await stakeTx.wait()
    log("Staked into sponsorship ", sponsorship.address)
}

async function deployENSCacheV2() {
    const sidechainWalletStreamReg = await ethersWallet(sidechainURL, defaultPrivateKey)

    const ensCacheScriptFactory = await ethers.getContractFactory("ENSCacheV2Streamr", sidechainWalletStreamReg)
    const scriptKeyAddress = "0xa3d1F77ACfF0060F7213D7BF3c7fEC78df847De1"
    const ensCacheScript = await upgrades.deployProxy(ensCacheScriptFactory, 
        [scriptKeyAddress,
            streamRegistryAddress,
            ensCachV1Address], { kind: "uups" })
    await ensCacheScript.deployed()

    log("ENSCacheV2 (chainlinkless) deployed at:", ensCacheScript.address)

    const role = await streamRegistryFromOwner.TRUSTED_ROLE()
    log(`granting trusted role ${role} to self ${sidechainWalletStreamReg.address}`)
    await (await streamRegistryFromOwner.grantRole(role, sidechainWalletStreamReg.address)).wait()

    log("setting ENSCache address in StreamRegistry")
    await (await streamRegistryFromOwner.setEnsCache(ensCacheScript.address)).wait()
    
    log(`granting trusted role ${role} ensaddress ${ensCacheScript.address}`)
    await (await streamRegistryFromOwner.grantRole(role, ensCacheScript.address)).wait()
    log("ensCacheScript address set as trusted role in streamregistry")
}

async function smartContractInitialization() {
    const wallet = await ethersWallet(chainURL, defaultPrivateKey)
    const sidechainWallet = await ethersWallet(sidechainURL, defaultPrivateKey)

    // log(`Deploying test DATAv2 from ${wallet.address}`)
    // const tokenDeployer = await new ContractFactory(TestTokenJson.abi, TestTokenJson.bytecode, wallet)
    // const tokenDeployTx = await tokenDeployer.deploy("Test DATAv2", "\ud83e\udd84") // unicorn
    // const token = await tokenDeployTx.deployed()
    // log(`New DATAv2 ERC20 deployed at ${token.address}`)

    log(`Deploying test DATAv2 from ${wallet.address}`)
    const tokenDeployer = await new ContractFactory(DATAv2.abi, DATAv2.bytecode, wallet)
    const tokenDeployTx = await tokenDeployer.deploy()
    const token = await tokenDeployTx.deployed()
    log(`New DATAv2 ERC20 deployed at ${token.address}`)

    // const sidechainWalletStreamReg = await ethersWallet(sidechainURL, privKeyStreamRegistry)
    // log('Deploying Streamregistry and chainlink contracts to sidechain:')
    // const linkTokenFactory = new ContractFactory(LinkToken.abi, LinkToken.bytecode, sidechainWalletStreamReg)
    // const linkTokenFactoryTx = await linkTokenFactory.deploy()
    // linkToken = await linkTokenFactoryTx.deployed()
    // log(`Link Token deployed at ${linkToken.address}`)
    // await (await linkToken.transfer(sidechainWalletStreamReg.address, ethers.utils.parseEther("1000000"))).wait()
    // await deploySponsorshipFactory()

    // log(`Deploying Marketplace1 contract from ${wallet.address}`)
    const marketDeployer1 = new ContractFactory(MarketplaceJson.abi, MarketplaceJson.bytecode, wallet)
    const marketDeployTx1 = await marketDeployer1.deploy(token.address, wallet.address)
    const market1 = await marketDeployTx1.deployed()
    log(`Marketplace1 deployed at ${market1.address}`)

    // log(`Deploying Marketplace2 contract from ${wallet.address}`)
    const marketDeployer2 = new ContractFactory(Marketplace2Json.abi, Marketplace2Json.bytecode, wallet)
    const marketDeployTx2 = await marketDeployer2.deploy(token.address, wallet.address, market1.address)
    const market = await marketDeployTx2.deployed()
    log(`Marketplace2 deployed at ${market.address}`)

    // log(`Deploying Uniswap Factory contract from ${wallet.address}`)
    const uniswapFactoryDeployer = new ContractFactory(uniswap_factory_abi, uniswap_factory_bytecode, wallet)
    const uniswapFactoryDeployTx = await uniswapFactoryDeployer.deploy()
    const uniswapFactory = await uniswapFactoryDeployTx.deployed()
    log(`Uniswap factory deployed at ${uniswapFactory.address}`)

    // log(`Deploying Uniswap Exchange template contract from ${wallet.address}`)
    const uniswapExchangeDeployer = new ContractFactory(uniswap_exchange_abi, uniswap_exchange_bytecode, wallet)
    const uniswapExchangeDeployTx = await uniswapExchangeDeployer.deploy()
    const uniswapExchangeTemplate = await uniswapExchangeDeployTx.deployed()
    log(`Uniswap exchange template deployed at ${uniswapExchangeTemplate.address}`)

    // log(`Deploying UniswapAdaptor contract from ${wallet.address}`)
    const uniswapAdaptorDeployer = new ContractFactory(UniswapAdaptor.abi, UniswapAdaptor.bytecode, wallet)
    const uniswapAdaptorDeployTx = await uniswapAdaptorDeployer.deploy(market.address, uniswapFactory.address, token.address)
    const uniswapAdaptor = await uniswapAdaptorDeployTx.deployed()
    log(`UniswapAdaptor deployed at ${uniswapAdaptor.address}`)

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

    log(`Minting ${mintTokenAmount} DATAv2 tokens to following addresses:`)
    for (const address of privateKeys.map(computeAddress)) {
        log("    %s", address)
        await token.mint(address, mintTokenAmount)
    }

    log("Init Uniswap1 factory")
    await uniswapFactory.initializeFactory(uniswapExchangeTemplate.address)
    log(`Init Uniswap1 exchange for DATAcoin token ${token.address}`)
    await uniswapFactory.createExchange(token.address, {gasLimit: 6000000})
    log(`Init Uniswap1 exchange for OTHERcoin token ${token2.address}`)
    const uniswapTx = await uniswapFactory.createExchange(token2.address, {gasLimit: 6000000})
    await uniswapTx.wait() // need wait here to call read methods below

    let datatoken_exchange_address = await uniswapFactory.getExchange(token.address)
    log(`DATAcoin traded at Uniswap1 exchange ${datatoken_exchange_address}`)
    let othertoken_exchange_address = await uniswapFactory.getExchange(token2.address)
    log(`OTHERcoin traded at Uniswap1 exchange ${othertoken_exchange_address}`)
    let datatokenExchange = new Contract(datatoken_exchange_address, uniswap_exchange_abi, wallet)
    let othertokenExchange = new Contract(othertoken_exchange_address, uniswap_exchange_abi, wallet)

    // wallet starts with 1000 ETH and 100000 of each token
    // add 10 ETH liquidity to tokens, set initial exchange rates
    let amt_eth = parseEther("40")
    let amt_token = parseEther("1000") // 1 ETH ~= 10 DATAcoin
    let amt_token2 = parseEther("10000") // 1 ETH ~= 100 OTHERcoin

    await token.approve(datatoken_exchange_address, amt_token)
    await token2.approve(othertoken_exchange_address, amt_token2)

    await datatokenExchange.addLiquidity(amt_token, amt_token, futureTime, {gasLimit: 6000000, value: amt_eth})
    await othertokenExchange.addLiquidity(amt_token2, amt_token2, futureTime, {gasLimit: 6000000, value: amt_eth})

    log(`Added liquidity to uniswap exchanges: ${formatEther(amt_token)} DATAcoin, ${formatEther(amt_token2)} OTHERcoin`)

    log(`Deploying NodeRegistry contract 1 (tracker registry) from ${wallet.address}`)
    let initialNodes = []
    let initialMetadata = []
    initialNodes.push('0xb9e7cEBF7b03AE26458E32a059488386b05798e8')
    initialMetadata.push('{"ws": "ws://10.200.10.1:30301", "http": "http://10.200.10.1:30301"}')
    initialNodes.push('0x0540A3e144cdD81F402e7772C76a5808B71d2d30')
    initialMetadata.push('{"ws": "ws://10.200.10.1:30302", "http": "http://10.200.10.1:30302"}')
    initialNodes.push('0xf2C195bE194a2C91e93Eacb1d6d55a00552a85E2')
    initialMetadata.push('{"ws": "ws://10.200.10.1:30303", "http": "http://10.200.10.1:30303"}')
    //1st NodeRegistry deployed here. 2nd below
    await deployNodeRegistry(wallet, initialNodes, initialMetadata)

    const ethwei = parseEther("1")
    let rate = await datatokenExchange.getTokenToEthInputPrice(ethwei)
    log(`1 DATAtoken buys ${formatEther(rate)} ETH`)
    rate = await othertokenExchange.getTokenToEthInputPrice(ethwei)
    log(`1 OTHERtoken buys ${formatEther(rate)} ETH`)

    //deployment steps based on https://github.com/ensdomains/ens/blob/2a6785c3b5fc27269eb3bb18b9d1245d1f01d6c8/migrations/2_deploy_contracts.js#L30
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
    let tx = await ens.setSubnodeOwner('0x0000000000000000000000000000000000000000000000000000000000000000', rootNode.sha3, fifs.address)
    await tx.wait()
    const resDeploy = new ContractFactory(PublicResolver.abi, PublicResolver.bytecode, wallet)
    const resDeployTx = await resDeploy.deploy(ens.address)
    const resolver = await resDeployTx.deployed()
    log(`PublicResolver deployed at ${resolver.address}`)

    const domains = ['testdomain1', 'testdomain2']
    const addresses = ['0x4178baBE9E5148c6D5fd431cD72884B07Ad855a0', '0xdC353aA3d81fC3d67Eb49F443df258029B01D8aB']
    for (var i = 0; i < domains.length; i++){
        const domain = domains[i]
        const owner = wallet.address
        const domainAddress = addresses[i]
        const fullname = domain + ".eth"
        const fullhash = namehash(fullname)

        log(`setting up ENS domain ${domain} with owner ${owner}, pointing to address ${domainAddress}`)
        tx = await fifs.register(Web3.utils.sha3(domain), owner)
        tr = await tx.wait()
        log(`called regsiter`)

        tx = await ens.setResolver(fullhash, resolver.address)
        tr = await tx.wait()
        log('called setResolver')

        //Ethers wont call the 2-arg setAddr. 60 is default = COIN_TYPE_ETH.
        //see https://github.com/ensdomains/resolvers/blob/master/contracts/profiles/AddrResolver.sol
        tx = await resolver.setAddr(fullhash, 60, domainAddress)
        tr = await tx.wait()
        log(`called setAddr. done registering ${fullname} as ${domainAddress}`)

        //transfer ownership
        tx = await ens.setOwner(fullhash, addresses[i])
        tr = await tx.wait()
        log(`transferred ownership to ${addresses[i]}`)
    }
    log("ENS init complete")

    // deploy 2nd NodeRegistry:
    // TODO remove this node registry deployment
    // this is not used any more, but still needs to be here because otherwise all following addresses would change
    // currently used ones is in deployRegistries() and is deployed proxified
    log(`Deploying OLD UNUSED NodeRegistry contract 2 (storage node registry) to sidechain from ${sidechainWallet.address}`)
    initialNodes = []
    initialMetadata = []
    initialNodes.push('0xde1112f631486CfC759A50196853011528bC5FA0')
    initialMetadata.push('{"http": "http://10.200.10.1:8891"}')
    await deployNodeRegistry(sidechainWallet, initialNodes, initialMetadata)

    log(`deploy Uniswap2 mainnet`)
    const router = await deployUniswap2(wallet)
    log(`deploy Uniswap2 sidechain`)
    const uniswapRouterSidechain = await deployUniswap2(sidechainWallet)

    tx = await token.approve(router.address, amt_token)
    //await tx.wait()
    tx = await token2.approve(router.address, amt_token2)
    await tx.wait()
    log(`addLiquidity Uniswap2 mainnet`)
    tx = await router.addLiquidity(token.address, token2.address, amt_token, amt_token2, 0, 0, wallet.address, futureTime)

    let cf = new ContractFactory(Uniswap2Adapter.abi, Uniswap2Adapter.bytecode, wallet)
    let dtx = await cf.deploy(market.address, router.address, token.address)
    const uniswap2Adapter = await dtx.deployed()
    log(`Uniswap2Adapter ${uniswap2Adapter.address}`)

    cf = new ContractFactory(BinanceAdapter.abi, BinanceAdapter.bytecode, sidechainWallet)
    //constructor(address dataCoin_, address honeyswapRouter_, address bscBridge_, address convertToCoin_, address liquidityToken_) public {
    dtx = await cf.deploy(sidechainDataCoin, uniswapRouterSidechain.address, sidechainSingleTokenMediator, sidechainDataCoin, sidechainDataCoin)
    const binanceAdapter = await dtx.deployed()
    log(`sidechain binanceAdapter ${binanceAdapter.address}`)

    await deployStreamRegistries()

    // TODO: move these deployments to the top once address change pains are solved
    log(`Deploying test DATAv1 from ${wallet.address}`)
    const oldTokenDeployer = new ContractFactory(OldTokenJson.abi, OldTokenJson.bytecode, wallet)
    const oldTokenDeployTx = await oldTokenDeployer.deploy("Test DATAv1", "\uD83D\uDC34", 0, 18, true) // horse face
    const oldToken = await oldTokenDeployTx.deployed()
    log(`Old DATAv1 ERC20 deployed at ${oldToken.address}`)

    log(`Deploying DataTokenMigrator from ${wallet.address}`)
    const migratorDeployer = new ContractFactory(DataTokenMigrator.abi, DataTokenMigrator.bytecode, wallet)
    const migratorDeployTx = await migratorDeployer.deploy(oldToken.address, token.address)
    const migrator = await migratorDeployTx.deployed()
    log(`New DataTokenMigrator at ${migrator.address}`)

    log('Set up the old token and mint %s test-DATAv1 (in total) to following:', oldSupply)
    await oldToken.setReleaseAgent(wallet.address)
    const mintAgentTx = await oldToken.setMintAgent(wallet.address, true)
    await mintAgentTx.wait()
    for (const address of privateKeys.map(computeAddress)) {
        log("    " + address)
        await oldToken.mint(address, mintTokenAmount)
    }
    await oldToken.mint(wallet.address, oldSupply.sub(mintTokenAmount.mul(privateKeys.length)))
    const oldTokenReleaseTx = await oldToken.releaseTokenTransfer()
    await oldTokenReleaseTx.wait()
    log('Old token getUpgradeState: %d, expected: 2', await oldToken.getUpgradeState())

    log('Set migrator as UpgradeAgent => start test-DATAv1 upgrade')
    const upgradeTx1 = await token.mint(migrator.address, await oldToken.totalSupply())
    await upgradeTx1.wait()
    const upgradeTx2 = await oldToken.setUpgradeAgent(migrator.address)
    await upgradeTx2.wait()
    log('Old token getUpgradeState: %d, expected: 3', await oldToken.getUpgradeState())

    log(`Minting ${mintTokenAmount} DATAv2 tokens to following addresses:`)
    for (const [projectName, testWalletCount] of projects) {
        for (let i = 0; i < testWalletCount; i++) {
            const testWallet = getTestWallet(projectName, i)
            log("    %s (%s #%d)", testWallet.address, projectName, i)
            await token.mint(testWallet.address, mintTokenAmount)
        }
    }

    await deployStreamStorageRegistry(sidechainWallet)

    const newWallet = new ethers.Wallet(privKeyStreamRegistry, new ethers.providers.JsonRpcProvider(sidechainURL))
    const marketDeployer3 = await ethers.getContractFactory(Marketplace2Json.abi, Marketplace2Json.bytecode, newWallet)
    const marketDeployTx3 = await marketDeployer3.deploy(
        sidechainDataCoin,
        sidechainWallet.address,
        '0x0000000000000000000000000000000000000000'
    )
    const market2 = await marketDeployTx3.deployed()
    log(`Marketplace2 deployed on sidechain at ${market2.address}`)

    const watcherDevopsKey = '0x628acb12df34bb30a0b2f95ec2e6a743b386c5d4f63aa9f338bec6f613160e78'
    const watcherWallet = new ethers.Wallet(watcherDevopsKey)
    const role = await streamRegistryFromOwner.TRUSTED_ROLE()
    log(`granting role ${role} to devops ${watcherWallet.address}`)
    const grantRoleTx2 = await streamRegistryFromOwner.grantRole(role, watcherWallet.address)
    await grantRoleTx2.wait()

    const projectRegistryV1 = await deployProjectRegistryV1(sidechainWallet)

    await deployMarketplaceV3(sidechainWallet)

    const chainId = 8997 // dev1
    const marketplaceV4 = await deployMarketplaceV4(sidechainWallet, projectRegistryV1.address, chainId)
    log(`Granting role ${role} to MarketplaceV4 at ${marketplaceV4.address}. ` +
        "Needed for granting permissions to streams using the trusted functions.")
    await(await projectRegistryV1.grantRole(id("TRUSTED_ROLE"), marketplaceV4.address)).wait()

    await deployProjectStakingV1(sidechainWallet, projectRegistryV1.address, linkToken.address)

    // granting here and not right after deployProjectRegistryV1 to avoid changing the addresses of MarketplaceV3, MarketplaceV4 and ProjectStakingV1
    log(`Granting role ${role} to ProjectRegistryV1 at ${projectRegistryV1.address}. ` +
        "Needed for granting permissions to streams using the trusted functions.")
    const grantRoleProjectRegistryV1Tx = await streamRegistryFromOwner.grantRole(role, projectRegistryV1.address)
    await grantRoleProjectRegistryV1Tx.wait()

    await deploySponsorshipFactory()

    await deployENSCacheV2()

    //put additions here

    //all TXs should now be confirmed:
    log("Loading test products from core")
    let products
    try {
        products = await getProducts()
    } catch (e) {
        console.error(e)
        process.exit(1)
    }

    log(`Adding ${products.length} products to Marketplace`)
    for (const p of products) {
        // free products not supported
        if (p.pricePerSecond == 0) {
            continue
        }
        log(`create ${p.id}`)
        const tx = await market.createProduct(`0x${p.id}`, p.name, wallet.address, p.pricePerSecond,
            p.priceCurrency == "DATA" ? 0 : 1, p.minimumSubscriptionInSeconds)
        await tx.wait()
        if (p.state == "NOT_DEPLOYED") {
            log(`delete ${p.id}`)
            await (await market.deleteProduct(`0x${p.id}`)).wait()
        }
    }

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
}

smartContractInitialization()
