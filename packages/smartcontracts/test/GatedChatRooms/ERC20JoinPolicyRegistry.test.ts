
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

        const ERC20 = await ethers.getContractFactory('TestERC20')
        token = await ERC20.deploy()

        await streamRegistryV3.createStream(
            streamPath,
            '{}',
        )

        const ERC20JoinPolicyRegistry = await ethers.getContractFactory('ERC20JoinPolicyRegistry', wallets[0])
        
        contract = await ERC20JoinPolicyRegistry.deploy(
            streamRegistryV3.address,
            [PermissionType.Subscribe, PermissionType.Publish],
        )

    })

    it ('happy-path for register method', async() => {
        const tx = await contract.register(
            token.address,
            streamId,
            1
        )

        const instanceAddress = await contract.tokensToJoinPolicies(token.address)

        await streamRegistryV3.grantPermission(
            streamId,
            instanceAddress,
            PermissionType.Grant
        )

        await streamRegistryV3.getPermissionsForUser(
            streamId,
            wallets[0].address
        )

        console.log('tx', tx)
    })

    it ('happy-path for requestDelegatedAccess in registered policy', async () => {

        await token.mint(wallets[1].address, BigNumber.from(1))

        const balance = await token.balanceOf(wallets[1].address)
        expect(balance).to.equal(BigNumber.from(1))

        const {
            signerIdentity, message, signature
        } = signDelegatedChallenge(wallets[1].address)
        
        const instanceAddress = await contract.tokensToJoinPolicies(token.address)
        console.log('instanceAddress', instanceAddress)

        const ERC20JoinPolicy = await ethers.getContractFactory('ERC20JoinPolicy', wallets[0])

        const instance = ERC20JoinPolicy.attach(instanceAddress)

        console.log('erc20 join policy instance', instance)

        await instance.connect(wallets[1])
        .requestDelegatedJoin(
            signerIdentity.address,
            message,
            signature,
            {from: wallets[1].address}
        )

        const events = await instance.queryFilter(
            instance.filters.Accepted()
        )
        expect(events.length).to.equal(1)
        expect(events[0].args).to.not.be.undefined
        expect(events[0].args!.user).to.equal(
            signerIdentity.address
        )
        
        expect(await streamRegistryV3.hasPermission(
            streamId,
            signerIdentity.address,
            PermissionType.Edit
        )).to.equal(false)

        expect(await streamRegistryV3.hasPermission(
            streamId,
            signerIdentity.address,
            PermissionType.Delete
        )).to.equal(false)
        expect(await streamRegistryV3.hasPermission(
            streamId,
            signerIdentity.address,
            PermissionType.Publish
        )).to.equal(true)
        expect(await streamRegistryV3.hasPermission(
            streamId,
            signerIdentity.address,
            PermissionType.Subscribe
        )).to.equal(true)
        expect(await streamRegistryV3.hasPermission(
            streamId,
            signerIdentity.address,
            PermissionType.Grant
        )).to.equal(false)
    })


})