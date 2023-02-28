// use ERC20JoinPolicy to test BaseJoinPolicy
// methods:
// requestLeave
// requestDelegatedLeave
// use ERC20JoinPolicy to test CoinJoinPolicy
// methods:
// requestJoin
// requestDelegatedJoin
// use ERC721JoinPolicy to test NftJoinPolicy
// methods:
// requestJoin(tokenId)
// requestDelegatedJoin(tokenId)

import { waffle, ethers } from 'hardhat'
import { expect, use } from 'chai'
import { BigNumber, Contract, ContractFactory } from 'ethers'

import { sign, hash, createIdentity } from 'eth-crypto'

import StreamRegistryV3 from '@streamr-contracts/network-contracts/artifacts/contracts/StreamRegistry/StreamRegistryV3.sol/StreamRegistryV3.json'

const { provider } = waffle

// eslint-disable-next-line no-unused-vars
enum PermissionType {
    Edit = 0,
    Delete,
    Publish,
    Subscribe,
    Grant,
}

enum ChallengeType {
    Authorize = 0,
    Revoke = 1,
}

const signDelegatedChallenge = (
    mainAddress: string,
    delegatedPrivateKey: string,
    challengeType: ChallengeType
) => {
    const message = hash.keccak256([
        { type: 'uint256', value: challengeType.toString() },
        { type: 'address', value: mainAddress },
    ])

    return sign(delegatedPrivateKey, message)
}

use(waffle.solidity)

describe('CoinJoinPolicy (via ERC20JoinPolicy)', (): void => {
    const zeroAddress = '0x0000000000000000000000000000000000000000'

    const wallets = provider.getWallets()
    let token: any
    let contract: Contract

    let streamRegistryV3: Contract
    const adminAddress: string = wallets[0].address

    const streamPath = '/foo/bar'
    const streamId = `${adminAddress}${streamPath}`.toLowerCase()

    let delegatedAccessRegistry: Contract

    const walletsToSigners: {
        [key: string]: { privateKey: string; publicKey: string; address: string }
    } = {}

    for (const wallet of wallets) {
        walletsToSigners[wallet.address] = createIdentity()
    }

    before(async (): Promise<void> => {
        const StreamRegistryV3Factory = new ContractFactory(
            StreamRegistryV3.abi,
            StreamRegistryV3.bytecode,
            wallets[0]
        )

        streamRegistryV3 = await StreamRegistryV3Factory.deploy()
        const ERC20 = await ethers.getContractFactory('TestERC20')
        token = await ERC20.deploy()

        await streamRegistryV3.createStream(streamPath, '{}')

        const ERC20JoinPolicy = await ethers.getContractFactory('ERC20JoinPolicy', wallets[0])

        const DelegatedAccessRegistry = await ethers.getContractFactory('DelegatedAccessRegistry')
        delegatedAccessRegistry = await DelegatedAccessRegistry.deploy()

        contract = await ERC20JoinPolicy.deploy(
            token.address,
            streamRegistryV3.address,
            streamId,
            [PermissionType.Publish, PermissionType.Subscribe],
            1, // minRequiredBalance
            delegatedAccessRegistry.address,
            false // disable staking
        )

        await streamRegistryV3.grantPermission(streamId, contract.address, PermissionType.Grant)

        await streamRegistryV3.getPermissionsForUser(streamId, wallets[0].address)

        for (const wallet of wallets) {
            const signature = signDelegatedChallenge(
                wallet.address,
                walletsToSigners[wallet.address].privateKey,
                ChallengeType.Authorize
            )

            await delegatedAccessRegistry
                .connect(wallet)
                .authorize(walletsToSigners[wallet.address].address, signature)
        }
    })

    describe('Direct Access', () => {
        const wallet = wallets[1]

        it('should fail to leave a stream if not joined', async () => {
            await expect(contract.connect(wallet).requestLeave()).to.be.revertedWith(
                "VM Exception while processing transaction: reverted with reason string 'error_walletNotAccepted'"
            )
        })

        it('should allow for a main account to be granted access via requestJoin', async () => {
            await token.mint(wallet.address, BigNumber.from(1))
            await contract.connect(wallet).requestJoin()

            const events = await contract.queryFilter(contract.filters.Accepted())
            expect(events.length).to.equal(1)
            expect(events[0].args).to.not.be.undefined

            expect(events[0].args!.mainWallet).to.equal(wallet.address)
            expect(events[0].args!.delegatedWallet).to.equal(zeroAddress)

            expect(
                await streamRegistryV3.hasPermission(streamId, wallet.address, PermissionType.Edit)
            ).to.equal(false)

            expect(
                await streamRegistryV3.hasPermission(
                    streamId,
                    wallet.address,
                    PermissionType.Delete
                )
            ).to.equal(false)
            expect(
                await streamRegistryV3.hasPermission(
                    streamId,
                    wallet.address,
                    PermissionType.Publish
                )
            ).to.equal(true)
            expect(
                await streamRegistryV3.hasPermission(
                    streamId,
                    wallet.address,
                    PermissionType.Subscribe
                )
            ).to.equal(true)
            expect(
                await streamRegistryV3.hasPermission(streamId, wallet.address, PermissionType.Grant)
            ).to.equal(false)
        })

        it('should revoke permissions after requestJoin', async () => {
            await contract.connect(wallet).requestLeave()

            const events = await contract.queryFilter(contract.filters.Revoked())

            expect(events.length).to.equal(1)

            expect(events[0].args).to.not.be.undefined

            expect(events[0].args!.mainWallet).to.equal(wallet.address)

            expect(events[0].args!.delegatedWallet).to.equal(zeroAddress)

            expect(
                await streamRegistryV3.hasPermission(streamId, wallet.address, PermissionType.Edit)
            ).to.equal(false)

            expect(
                await streamRegistryV3.hasPermission(
                    streamId,
                    wallet.address,
                    PermissionType.Delete
                )
            ).to.equal(false)
            expect(
                await streamRegistryV3.hasPermission(
                    streamId,
                    wallet.address,
                    PermissionType.Publish
                )
            ).to.equal(false)
            expect(
                await streamRegistryV3.hasPermission(
                    streamId,
                    wallet.address,
                    PermissionType.Subscribe
                )
            ).to.equal(false)
            expect(
                await streamRegistryV3.hasPermission(streamId, wallet.address, PermissionType.Grant)
            ).to.equal(false)
        })
    })

    describe('Delegated Access', () => {
        const wallet = wallets[2]
        const signerIdentity = walletsToSigners[wallet.address]

        it('should fail to leave a stream if not joined', async () => {
            await expect(contract.connect(wallet).requestDelegatedLeave()).to.be.revertedWith(
                "VM Exception while processing transaction: reverted with reason string 'error_walletNotAccepted'"
            )
        })

        it('requestDelegatedJoin, happy-path', async () => {
            await token.mint(wallet.address, BigNumber.from(1))
            const balance = await token.balanceOf(wallet.address)
            expect(balance).to.equal(BigNumber.from(1))

            await contract.connect(wallet).requestDelegatedJoin()

            const events = await contract.queryFilter(contract.filters.Accepted())
            expect(events.length).to.equal(2)
            expect(events[1].args).to.not.be.undefined

            expect(events[1].args!.mainWallet).to.equal(wallet.address)
            expect(events[1].args!.delegatedWallet).to.equal(signerIdentity.address)

            expect(
                await streamRegistryV3.hasPermission(
                    streamId,
                    signerIdentity.address,
                    PermissionType.Edit
                )
            ).to.equal(false)

            expect(
                await streamRegistryV3.hasPermission(
                    streamId,
                    signerIdentity.address,
                    PermissionType.Delete
                )
            ).to.equal(false)
            expect(
                await streamRegistryV3.hasPermission(
                    streamId,
                    signerIdentity.address,
                    PermissionType.Publish
                )
            ).to.equal(true)
            expect(
                await streamRegistryV3.hasPermission(
                    streamId,
                    signerIdentity.address,
                    PermissionType.Subscribe
                )
            ).to.equal(true)
            expect(
                await streamRegistryV3.hasPermission(
                    streamId,
                    signerIdentity.address,
                    PermissionType.Grant
                )
            ).to.equal(false)
        })

        it('should revoke permissions for delegated wallet after requestDelegatedJoin', async () => {
            await contract.connect(wallet).requestDelegatedLeave()

            const events = await contract.queryFilter(contract.filters.Revoked())

            expect(events.length).to.equal(2)

            expect(events[1].args).to.not.be.undefined

            expect(events[1].args!.mainWallet).to.equal(wallet.address)

            expect(events[1].args!.delegatedWallet).to.equal(signerIdentity.address)
        })
    })
})
