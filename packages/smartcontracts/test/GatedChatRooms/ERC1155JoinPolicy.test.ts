import { waffle, upgrades, ethers } from 'hardhat'
import { expect, use } from 'chai'
import { BigNumber, Contract} from 'ethers'

import ForwarderJson from '../../artifacts/@openzeppelin/contracts/metatx/MinimalForwarder.sol/MinimalForwarder.json'
import type { MinimalForwarder } from '../../typechain/MinimalForwarder'
import type { StreamRegistry } from '../../typechain/StreamRegistry'
import {sign, hash, createIdentity} from 'eth-crypto'

const { deployContract } = waffle
const { provider } = waffle

// eslint-disable-next-line no-unused-vars
enum PermissionType { Edit = 0, Delete, Publish, Subscribe, Grant }

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
describe('ERC1155JoinPolicy', (): void => {
    const wallets = provider.getWallets()
    let token: any 
    let contract: Contract

    let streamRegistryV3: StreamRegistry
    let minimalForwarderFromUser0: MinimalForwarder
    const adminAddress: string = wallets[0].address

    const streamPath = '/foo/bar'
    const streamId = `${adminAddress}${streamPath}`.toLowerCase()

    enum TokenIds { A = 1, B, C}
    const signerIdentity = createIdentity()

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

        const ERC1155 = await ethers.getContractFactory('TestERC1155')
        token = await ERC1155.deploy()

        await streamRegistryV3.createStream(
            streamPath,
            '{}',
        )

        const DelegatedAccessRegistry = await ethers.getContractFactory('DelegatedAccessRegistry')
        delegatedAccessRegistry = await DelegatedAccessRegistry.deploy()
        
        const signature = signDelegatedChallenge(
            wallets[0].address, 
            signerIdentity.privateKey,
            ChallengeType.Authorize
        )

        await delegatedAccessRegistry.connect(wallets[0]).authorize(
            signerIdentity.address,
            signature
        )

        const ERC1155JoinPolicy = await ethers.getContractFactory('ERC1155JoinPolicy', wallets[0])
       
        contract = await ERC1155JoinPolicy.deploy(
            token.address,
            streamRegistryV3.address,
            streamId,
            [
                PermissionType.Publish, PermissionType.Subscribe
            ],
            TokenIds.A,
            1, // minRequiredBalance    
            delegatedAccessRegistry.address,
            false // disable staking
        )

        await streamRegistryV3.grantPermission(
            streamId,
            contract.address,
            PermissionType.Grant
        )

    })

    it ('should fail to complete depositStake, reason: stakingDisabled', async () => {
        await expect(contract.connect(wallets[0]).depositStake(0)).to.be.revertedWith('stakingDisabled')
    })

    it ('should fail to complete withdrawStake, reason: stakingDisabled', async () => {
        await expect(contract.connect(wallets[0]).withdrawStake(0)).to.be.revertedWith('stakingDisabled')
    })

    it ('should fail to deploy a policy with 0 as minimum required balance', async () => {
        const ERC1155JoinPolicy = await ethers.getContractFactory('ERC1155JoinPolicy', wallets[0])
        await expect(ERC1155JoinPolicy.deploy(
            token.address,
            streamRegistryV3.address,
            streamId + '/fail',
            [
                PermissionType.Publish, PermissionType.Subscribe
            ],
            TokenIds.B,
            0, // minRequiredBalance    
            delegatedAccessRegistry.address,
            false // disable staking
        )).to.be.revertedWith('VM Exception while processing transaction: reverted with reason string \'error_minReqBalanceGt0\'')
    })
    
    it('should fail to grant permissions if not enough balance found', async (): Promise<void> => {
        await expect(contract.connect(wallets[0]).requestDelegatedJoin())
        .to.be.revertedWith("VM Exception while processing transaction: reverted with reason string 'error_notEnoughTokens'")
    })

    it ('should fail to grant permissions if account is not authorized on DelegatedAccessRegistry', async () => {
        await expect(contract.connect(wallets[1]).requestDelegatedJoin())
        .to.be.revertedWith('VM Exception while processing transaction: reverted with reason string \'error_notAuthorized\'')
    })
    
    it ('should grant 1 token to a user and fullfil their requestDelegatedJoin', async () => {
        await token.mint(wallets[0].address, TokenIds.A, 1)
        const balance = await token.balanceOf(wallets[0].address, TokenIds.A)
        expect(balance).to.equal(BigNumber.from(1))
            
        await contract.connect(wallets[0])
        .requestDelegatedJoin()

        const events = await contract.queryFilter(
            contract.filters.Accepted()
        )
        expect(events.length).to.equal(1)
        expect(events[0].args).to.not.be.undefined

        expect(events[0].args!.mainWallet).to.equal(
            wallets[0].address
        )

        expect(events[0].args!.delegatedWallet).to.equal(
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

    it ('should fail to exercise the requestJoin when not enough tokens are available', async () => {
        await expect(contract.connect(wallets[5]).requestJoin())
        .to.be.revertedWith("VM Exception while processing transaction: reverted with reason string 'error_notEnoughTokens'")
    })

    it ('should allow for a main account to be granted access via requestJoin', async () => {
        await token.connect(wallets[0]).safeTransferFrom(
            wallets[0].address,
            wallets[5].address, 
            TokenIds.A,
            1,
            '0x'
        )
        await contract.connect(wallets[5]).requestJoin()

        const events = await contract.queryFilter(
            contract.filters.Accepted()
        )
        expect(events.length).to.equal(2)
        expect(events[1].args).to.not.be.undefined
        
        expect(events[1].args!.mainWallet).to.equal(
            wallets[5].address
        )
        expect(events[1].args!.delegatedWallet).to.equal(
            '0x0000000000000000000000000000000000000000'
        )
        
        expect(await streamRegistryV3.hasPermission(
            streamId,
            wallets[5].address,
            PermissionType.Edit
        )).to.equal(false)

        expect(await streamRegistryV3.hasPermission(
            streamId,
            wallets[5].address,
            PermissionType.Delete
        )).to.equal(false)
        expect(await streamRegistryV3.hasPermission(
            streamId,
            wallets[5].address,
            PermissionType.Publish
        )).to.equal(true)
        expect(await streamRegistryV3.hasPermission(
            streamId,
            wallets[5].address,
            PermissionType.Subscribe
        )).to.equal(true)
        expect(await streamRegistryV3.hasPermission(
            streamId,
            wallets[5].address,
            PermissionType.Grant
        )).to.equal(false)
    })



    describe('ERC1155JoinPolicy - StakeGate', async () => {
        const mainWallet = wallets[2]
        const delegatedWallet = createIdentity()
        const TokenAmount = 10

        let stakedContract: Contract

        before(async (): Promise<void> => {

            const ERC1155JoinPolicy = await ethers.getContractFactory('ERC1155JoinPolicy', wallets[0])

            stakedContract = await ERC1155JoinPolicy.deploy(
     
            token.address,
            streamRegistryV3.address,
            streamId,
            [
                PermissionType.Publish, PermissionType.Subscribe
            ],
            TokenIds.C,
            1, // minRequiredBalance    
            delegatedAccessRegistry.address,
            true // staking enabled
        )



            await streamRegistryV3.grantPermission(
                streamId,
                stakedContract.address,
                PermissionType.Grant
            )

            const signature = signDelegatedChallenge(
                mainWallet.address,
                delegatedWallet.privateKey,
                ChallengeType.Authorize
            )

            await delegatedAccessRegistry.connect(mainWallet).authorize(
                delegatedWallet.address,
                signature
            )
        })

        it ('should exercise the depositStake method, happy-path', async () => {
            await token.mint(mainWallet.address, TokenIds.C, TokenAmount)
            const balance = await token.balanceOf(mainWallet.address, TokenIds.C)
            expect(balance).to.equal(TokenAmount)
            await token.connect(mainWallet).setApprovalForAll(stakedContract.address, true)

            await stakedContract.connect(mainWallet)
            .depositStake(
                TokenAmount
            )
            
            const afterBalance = await token.balanceOf(mainWallet.address, TokenIds.C)
            expect(afterBalance).to.equal(0)


            const events = await stakedContract.queryFilter(
                stakedContract.filters.Accepted()
            )
            expect(events.length).to.equal(1)
            expect(events[0].args).to.not.be.undefined
            
            expect(events[0].args!.mainWallet).to.equal(
                mainWallet.address
            )
            expect(events[0].args!.delegatedWallet).to.equal(
                delegatedWallet.address
            )
            
            expect(await streamRegistryV3.hasPermission(
                streamId,
                delegatedWallet.address,
                PermissionType.Edit
            )).to.equal(false)

            expect(await streamRegistryV3.hasPermission(
                streamId,
                delegatedWallet.address,
                PermissionType.Delete
            )).to.equal(false)
            expect(await streamRegistryV3.hasPermission(
                streamId,
                delegatedWallet.address,
                PermissionType.Publish
            )).to.equal(true)
            expect(await streamRegistryV3.hasPermission(
                streamId,
                delegatedWallet.address,
                PermissionType.Subscribe
            )).to.equal(true)
            expect(await streamRegistryV3.hasPermission(
                streamId,
                delegatedWallet.address,
                PermissionType.Grant
            )).to.equal(false)

           
        })

        it ('should fail depositStake, reason: not enough balance', async () => {
            await expect(stakedContract.connect(mainWallet).depositStake(100))
            .to.be.revertedWith("VM Exception while processing transaction: reverted with reason string 'error_notEnoughTokens'")
        })

        it ('should fail to complete depositStake, reason: unauthorized', async() => {
            await expect(stakedContract.connect(wallets[5]).depositStake(100))
            .to.be.revertedWith("VM Exception while processing transaction: reverted with reason string 'error_notAuthorized'")
        })

        it ('should fail to complete withdrawStake, reason: unauthorized', async () => {
            await expect(stakedContract.connect(wallets[5]).withdrawStake(100))
            .to.be.revertedWith("VM Exception while processing transaction: reverted with reason string 'error_notAuthorized'")
        })

        it ('should exercise withdrawStake with an inferior amount to the treshold', async () => {
            await stakedContract.connect(mainWallet).withdrawStake(1)
            const afterBalance = await token.balanceOf(mainWallet.address, TokenIds.C)
            expect(afterBalance).to.equal(1)
        })

        it ('should exercise the withdrawStake, happy-path', async () => {
            const initialBalance = await token.balanceOf(mainWallet.address, TokenIds.C)
            expect(initialBalance).to.equal(1)

            const contractBalance = await token.balanceOf(stakedContract.address, TokenIds.C)
            expect(contractBalance).to.equal(TokenAmount - initialBalance)

            await stakedContract.connect(mainWallet).withdrawStake(
                contractBalance
            )

            const afterBalance = await token.balanceOf(mainWallet.address, TokenIds.C)
            expect(afterBalance).to.equal(TokenAmount)
        })

        it ('should fail to call withdrawStake, reason: insufficient balance', async () => {
            await expect(stakedContract.connect(mainWallet).withdrawStake(
                TokenAmount
            )).to.be.revertedWith('M Exception while processing transaction: reverted with reason string \'ERC1155: insufficient balance for transfer\'')
        })
    })
})