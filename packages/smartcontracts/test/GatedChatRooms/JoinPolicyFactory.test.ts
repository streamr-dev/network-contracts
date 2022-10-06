import { waffle, ethers, upgrades } from 'hardhat'
import { expect, use } from 'chai'
import { Contract} from 'ethers'
import { StreamRegistry } from '../../typechain'
import { deployContract } from 'ethereum-waffle'
import ForwarderJson from '../../artifacts/@openzeppelin/contracts/metatx/MinimalForwarder.sol/MinimalForwarder.json'
import type { MinimalForwarder } from '../../typechain/MinimalForwarder'

const { provider } = waffle

use(waffle.solidity)
describe('JoinPolicyFactory', (): void => {
    enum PermissionType { Edit = 0, Delete, Publish, Subscribe, Grant }

    const wallets = provider.getWallets()
    let contract: Contract

    const TokenId = 1234567890

    let erc20Token: Contract
    let erc721Token: Contract
    let erc1155Token: Contract

    let streamRegistryV3: StreamRegistry
    let minimalForwarderFromUser0: MinimalForwarder
    const adminAddress: string = wallets[0].address

    const streamPath = '/foo/bar'
    const streamId = `${adminAddress}${streamPath}`.toLowerCase()

    let delegatedAccessRegistry: Contract

    before(async (): Promise<void> => {
        minimalForwarderFromUser0 = await deployContract(wallets[9], ForwarderJson) as MinimalForwarder
        const streamRegistryFactoryV2 = await ethers.getContractFactory('StreamRegistryV2', wallets[0])
        const streamRegistryFactoryV2Tx = await upgrades.deployProxy(streamRegistryFactoryV2,
            ['0x0000000000000000000000000000000000000000', minimalForwarderFromUser0.address], {
                kind: 'uups'
            })
        streamRegistryV3 = await streamRegistryFactoryV2Tx.deployed() as StreamRegistry
        // to upgrade the deployer must also have the trusted role
        // we will grant it and revoke it after the upgrade to keep admin and trusted roles separate
        await streamRegistryV3.grantRole(await streamRegistryV3.TRUSTED_ROLE(), wallets[0].address)
        const streamregistryFactoryV3 = await ethers.getContractFactory('StreamRegistryV3', wallets[0])
        const streamRegistryFactoryV3Tx = await upgrades.upgradeProxy(streamRegistryFactoryV2Tx.address,
            streamregistryFactoryV3)
        await streamRegistryV3.revokeRole(await streamRegistryV3.TRUSTED_ROLE(), wallets[0].address)
        // eslint-disable-next-line require-atomic-updates
        streamRegistryV3 = await streamRegistryFactoryV3Tx.deployed() as StreamRegistry

        // setup test tokens
        const ERC20 = await ethers.getContractFactory('TestERC20')
        erc20Token = await ERC20.deploy()

        const ERC721 = await ethers.getContractFactory('TestERC721')
        erc721Token = await ERC721.deploy()

        const ERC1155 = await ethers.getContractFactory('TestERC1155')
        erc1155Token = await ERC1155.deploy()

        // create the stream
        await streamRegistryV3.createStream(
            streamPath,
            '{}',
        )

        // deploy the delegatedAccessRegistry
        const DelegatedAccessRegistry = await ethers.getContractFactory('DelegatedAccessRegistry', wallets[0])
        delegatedAccessRegistry = await DelegatedAccessRegistry.deploy()
        
        // deploy the JoinPolicyFactory
        const JoinPolicyFactory = await ethers.getContractFactory('JoinPolicyFactory', wallets[0])
        contract = await JoinPolicyFactory.deploy(
            streamRegistryV3.address,
            [PermissionType.Subscribe, PermissionType.Publish],
            delegatedAccessRegistry.address
        )

    })

    it ('should properly exercise `registerERC20Policy`', async() => {
        
        await contract.registerERC20Policy(
            erc20Token.address,
            streamId,
            1
        )  
        
        const policyAddress = await contract.erc20TokensToJoinPolicies(erc20Token.address, streamId)
        expect(policyAddress).to.not.equal('0x0000000000000000000000000000000000000000')
    })

    it ('should fail to re-register an ERC20 JoinPolicy', async () => {
        try {
            await contract.registerERC20Policy(
                erc20Token.address,
                streamId,
                1
            )
        } catch (e: any){
            expect(e.message).to.equal('VM Exception while processing transaction: reverted with reason string \'Join policy already registered\'')
        }
    })

    it ('should properly exercise `registerERC721Policy`', async() => {
        await contract.registerERC721Policy(
            erc721Token.address,
            TokenId,
            streamId
        )

        const policyAddress = await contract.erc721TokensToJoinPolicies(erc721Token.address, TokenId, streamId)
        expect(policyAddress).to.not.equal('0x0000000000000000000000000000000000000000')
    })

    it ('should fail to re-register an ERC721 JoinPolicy', async () => {
        try {
            await contract.registerERC721Policy(
                erc721Token.address,
                TokenId,
                streamId
            )
        } catch (e: any){
            expect(e.message).to.equal('VM Exception while processing transaction: reverted with reason string \'Join policy already registered\'')
        }
    })

    it ('should properly exercise `registerERC1155Policy`', async() => {      
        await contract.registerERC1155Policy(
            erc1155Token.address,
            TokenId,
            streamId,
            1
        )      

        const policyAddress = await contract.erc1155TokensToJoinPolicies(
            erc1155Token.address,
            TokenId,
            streamId
        )

        expect(policyAddress).to.not.equal('0x0000000000000000000000000000000000000000')
    })

    it ('should fail to re-register an ERC1155 JoinPolicy', async () => {
        try {
            await contract.registerERC1155Policy(
                erc1155Token.address,
                TokenId,
                streamId,
                1
            )
        } catch (e: any){
            expect(e.message).to.equal('VM Exception while processing transaction: reverted with reason string \'Join policy already registered\'')
        }
    })
})