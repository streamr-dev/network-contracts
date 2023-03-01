import { waffle, ethers } from 'hardhat'
import { expect, use } from 'chai'
import { Contract, ContractFactory } from 'ethers'

import StreamRegistryV3 from '@streamr-contracts/network-contracts/artifacts/contracts/StreamRegistry/StreamRegistryV3.sol/StreamRegistryV3.json'

const { provider } = waffle

enum PermissionType {
    Edit = 0,
    Delete,
    Publish,
    Subscribe,
    Grant,
}

use(waffle.solidity)
describe('TokenGatedFactories', (): void => {
    const wallets = provider.getWallets()
    const TokenId = 1234567890
    const streamPath = '/foo/bar'
    const StakingEnabled = false

    let streamRegistryV3: Contract
    let delegatedAccessRegistry: Contract
    let joinPolicyRegistry: Contract

    before(async (): Promise<void> => {
        const StreamRegistryV3Factory = new ContractFactory(
            StreamRegistryV3.abi,
            StreamRegistryV3.bytecode,
            wallets[0]
        )

        streamRegistryV3 = await StreamRegistryV3Factory.deploy()

        await streamRegistryV3.createStream(streamPath, '{}')

        const DelegatedAccessRegistry = await ethers.getContractFactory('DelegatedAccessRegistry')
        delegatedAccessRegistry = await DelegatedAccessRegistry.deploy()

        const JoinPolicyRegistry = await ethers.getContractFactory('JoinPolicyRegistry')
        joinPolicyRegistry = await JoinPolicyRegistry.deploy()
    })

    describe('ERC20PolicyFactory', (): void => {
        const streamId = `erc20/${wallets[0].address}${streamPath}`.toLowerCase()

        let factory: Contract
        let token: Contract

        before(async (): Promise<void> => {
            const ERC20 = await ethers.getContractFactory('TestERC20')
            token = await ERC20.deploy()

            const ERC20PolicyFactory = await ethers.getContractFactory('ERC20PolicyFactory')
            factory = await ERC20PolicyFactory.deploy(
                joinPolicyRegistry.address,
                streamRegistryV3.address,
                delegatedAccessRegistry.address
            )
        })

        it('should exercise the deploy method', async () => {
            await factory.create(
                token.address,
                streamId,
                1, // minRequiredBalance,
                [0], // trivial, tokenId
                StakingEnabled,
                [PermissionType.Subscribe, PermissionType.Publish] // permissions
            )

            const policyAddress = await joinPolicyRegistry.getPolicy(
                token.address,
                0, // tokenId
                streamId,
                false // stakingEnabled
            )

            expect(policyAddress).to.not.equal('0x0000000000000000000000000000000000000000')
        })

        it('should fail to deploy a duplicated policy', async () => {
            await expect(
                factory.create(
                    token.address,
                    streamId,
                    1, // minRequiredBalance,
                    [0], // trivial, tokenId
                    StakingEnabled,
                    [PermissionType.Subscribe, PermissionType.Publish] // permissions
                )
            ).to.be.revertedWith('error_alreadyRegistered')
        })
    })

    describe('ERC721PolicyFactory', (): void => {
        const streamId = `erc721/${wallets[0].address}${streamPath}`.toLowerCase()

        let factory: Contract
        let token: Contract

        before(async (): Promise<void> => {
            const ERC721 = await ethers.getContractFactory('TestERC721')
            token = await ERC721.deploy()

            const ERC721PolicyFactory = await ethers.getContractFactory('ERC721PolicyFactory')
            factory = await ERC721PolicyFactory.deploy(
                joinPolicyRegistry.address,
                streamRegistryV3.address,
                delegatedAccessRegistry.address
            )
        })

        it('should exercise the deploy method', async () => {
            await factory.create(
                token.address,
                streamId,
                0, // minRequiredBalance,
                [TokenId],
                StakingEnabled,
                [PermissionType.Subscribe, PermissionType.Publish] // permissions
            )

            const policyAddress = await joinPolicyRegistry.getPolicy(
                token.address,
                TokenId,
                streamId,
                false // stakingEnabled
            )

            expect(policyAddress).to.not.equal('0x0000000000000000000000000000000000000000')
        })

        it('should fail to deploy a duplicated policy', async () => {
            await expect(
                factory.create(
                    token.address,
                    streamId,
                    1, // minRequiredBalance,
                    [TokenId],
                    StakingEnabled,
                    [PermissionType.Subscribe, PermissionType.Publish] // permissions
                )
            ).to.be.revertedWith('error_alreadyRegistered')
        })
    })

    describe('ERC777PolicyFactory', (): void => {
        const streamId = `erc777/${wallets[0].address}${streamPath}`.toLowerCase()

        let factory: Contract
        let token: Contract

        before(async (): Promise<void> => {
            const ERC777 = await ethers.getContractFactory('TestERC777')
            token = await ERC777.deploy()

            const ERC777PolicyFactory = await ethers.getContractFactory('ERC777PolicyFactory')
            factory = await ERC777PolicyFactory.deploy(
                joinPolicyRegistry.address,
                streamRegistryV3.address,
                delegatedAccessRegistry.address
            )
        })

        it('should exercise the deploy method', async () => {
            await factory.create(
                token.address,
                streamId,
                1, // minRequiredBalance,
                [0], // trivial, tokenId
                StakingEnabled,
                [PermissionType.Subscribe, PermissionType.Publish] // permissions
            )

            const policyAddress = await joinPolicyRegistry.getPolicy(
                token.address,
                [0], // tokenId
                streamId,
                false // stakingEnabled
            )

            expect(policyAddress).to.not.equal('0x0000000000000000000000000000000000000000')
        })

        it('should fail to deploy a duplicated policy', async () => {
            await expect(
                factory.create(
                    token.address,
                    streamId,
                    1, // minRequiredBalance,
                    [0], // trivial, tokenId
                    StakingEnabled,
                    [PermissionType.Subscribe, PermissionType.Publish] // permissions
                )
            ).to.be.revertedWith('error_alreadyRegistered')
        })
    })

    describe('ERC1155PolicyFactory', (): void => {
        const streamId = `erc1155/${wallets[0].address}${streamPath}`.toLowerCase()

        let factory: Contract
        let token: Contract

        before(async (): Promise<void> => {
            const ERC1155 = await ethers.getContractFactory('TestERC1155')
            token = await ERC1155.deploy()

            const ERC1155PolicyFactory = await ethers.getContractFactory('ERC1155PolicyFactory')
            factory = await ERC1155PolicyFactory.deploy(
                joinPolicyRegistry.address,
                streamRegistryV3.address,
                delegatedAccessRegistry.address
            )
        })

        it('should exercise the deploy method', async () => {
            await factory.create(
                token.address,
                streamId,
                12, // minRequiredBalance,
                [TokenId],
                StakingEnabled,
                [PermissionType.Subscribe, PermissionType.Publish] // permissions
            )

            const policyAddress = await joinPolicyRegistry.getPolicy(
                token.address,
                TokenId,
                streamId,
                false // stakingEnabled
            )

            expect(policyAddress).to.not.equal('0x0000000000000000000000000000000000000000')
        })

        it('should fail to deploy a duplicated policy', async () => {
            await expect(
                factory.create(
                    token.address,
                    streamId,
                    7, // minRequiredBalance,
                    [TokenId],
                    StakingEnabled,
                    [PermissionType.Subscribe, PermissionType.Publish] // permissions
                )
            ).to.be.revertedWith('error_alreadyRegistered')
        })
    })
})
