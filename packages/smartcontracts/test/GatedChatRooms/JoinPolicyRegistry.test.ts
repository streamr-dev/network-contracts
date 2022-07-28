
import { waffle, ethers, upgrades } from 'hardhat'
import { expect, use } from 'chai'
import { BigNumber, Contract} from 'ethers'
import EthCrypto from 'eth-crypto'
import { StreamRegistry } from '../../typechain'
import { MinimalForwarder } from '../../test-contracts/MinimalForwarder'
import { deployContract } from 'ethereum-waffle'
import ForwarderJson from '../../test-contracts/MinimalForwarder.json'

const { provider } = waffle


const signDelegatedChallenge = (address: string) => {
    const signerIdentity = EthCrypto.createIdentity();
    const message = EthCrypto.hash.keccak256(address);
    const signature = EthCrypto.sign(signerIdentity.privateKey, message)
    return {
        signerIdentity, message, signature
    }
}
use(waffle.solidity)
describe('ERC20JoinPolicyRegistry', (): void => {
    enum PermissionType { Edit = 0, Delete, Publish, Subscribe, Grant }

    const wallets = provider.getWallets()
    let contract: Contract

    let signerIdentity: any 
    let message: string 
    let signature: string
    let token: Contract 
    let erc20Token: Contract
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
        
        // deploy the JoinPolicyRegistry
        const JoinPolicyRegistry = await ethers.getContractFactory('JoinPolicyRegistry', wallets[0])
        contract = await JoinPolicyRegistry.deploy(
            streamRegistryV3.address,
            [PermissionType.Subscribe, PermissionType.Publish],
            delegatedAccessRegistry.address
        )

    })

    it ('should properly exercise `registerERC20Policy`', async () => {
        const tx = await contract.registerERC20Policy(
            erc20Token.address,
            streamId,
            1
        )

        const event: any = contract.filters.Registered(erc20Token.address)

        const registeredPolicyAddress = await contract.registeredPolicies(event.topics[1])
        expect(registeredPolicyAddress).to.equal(event.topics[0])
    })

})