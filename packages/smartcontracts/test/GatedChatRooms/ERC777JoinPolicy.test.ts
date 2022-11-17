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
describe('ERC777JoinPolicy', (): void => {
    const wallets = provider.getWallets()
    let token: any 
    let contract: Contract

    let streamRegistryV3: StreamRegistry
    let minimalForwarderFromUser0: MinimalForwarder
    const adminAddress: string = wallets[0].address

    const streamPath = '/foo/bar'
    const streamId = `${adminAddress}${streamPath}`.toLowerCase()

    let delegatedAccessRegistry: Contract

    const signerIdentity = createIdentity()

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

        const ERC777 = await ethers.getContractFactory('TestERC777')
        token = await ERC777.deploy()

        await streamRegistryV3.createStream(
            streamPath,
            '{}',
        )

        const ERC777JoinPolicy = await ethers.getContractFactory('ERC777JoinPolicy', wallets[0])

        const DelegatedAccessRegistry = await ethers.getContractFactory('DelegatedAccessRegistry')
        delegatedAccessRegistry = await DelegatedAccessRegistry.deploy()

        contract = await ERC777JoinPolicy.deploy(
            token.address,
            streamRegistryV3.address,
            streamId,
            [
                PermissionType.Publish, PermissionType.Subscribe
            ],
            1, // minRequiredBalance
            delegatedAccessRegistry.address,
            false // stakingEnabled
        )

        await streamRegistryV3.grantPermission(
            streamId,
            contract.address,
            PermissionType.Grant
        )

        const signature = signDelegatedChallenge(
            wallets[1].address,
            signerIdentity.privateKey,
            ChallengeType.Authorize
        )

        await delegatedAccessRegistry.connect(wallets[1]).authorize(
            signerIdentity.address,
            signature
        )
    })

    it ('should fail to deploy a policy with 0 as minimumRequiredBalance', async () => {
        const ERC777JoinPolicy = await ethers.getContractFactory('ERC777JoinPolicy', wallets[0])
        await expect(ERC777JoinPolicy.deploy(
            token.address,
            streamRegistryV3.address,
            streamId,
            [
                PermissionType.Publish, PermissionType.Subscribe
            ],
            0, // minRequiredBalance
            delegatedAccessRegistry.address,
            false
        )).to.be.revertedWith('VM Exception while processing transaction: reverted with reason string \'error_minReqBalanceGt0\'')
    })

    it ('should fail to grant permissions if account is not authorized on DelegatedAccessRegistry', async () => {
        await expect(contract.requestDelegatedJoin(
            wallets[2].address, 
            0 // trivial tokenId
        )).to.be.revertedWith('VM Exception while processing transaction: reverted with reason string \'error_notAuthorized\'')
    })

    it('should fail to grant permissions if not enough balance found', async (): Promise<void> => {
            const balance = await token.balanceOf(wallets[1].address)
            expect(balance).to.equal(BigNumber.from(0))

            await expect(contract.connect(wallets[1])
                .requestDelegatedJoin(
                    signerIdentity.address,
                    0, // trivial tokenId
                    {from: wallets[1].address}
                )).to.be.revertedWith("VM Exception while processing transaction: reverted with reason string 'error_notEnoughTokens'")
    })

    it ('should grant 1 token to a user and fullfil their requestDelegatedJoin', async () => {
        await token.mint(wallets[1].address, BigNumber.from(1))
        const balance = await token.balanceOf(wallets[1].address)
        expect(balance).to.equal(BigNumber.from(1))

        await contract.connect(wallets[1])
            .requestDelegatedJoin(
                signerIdentity.address,
                0, // trivial tokenId
                {from: wallets[1].address}
            )

        const events = await contract.queryFilter(
            contract.filters.Accepted()
        )
        expect(events.length).to.equal(1)
        expect(events[0].args).to.not.be.undefined
        
        expect(events[0].args!.mainWallet).to.equal(
            wallets[1].address
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

    /*

    describe ('ERC777JoinPolicy - StakeGate', async () => {
        const mainWallet = wallets[2]
        const delegatedWallet = createIdentity()

        let stakedContract: Contract

        before(async (): Promise<void> => {

            const ERC777JoinPolicy = await ethers.getContractFactory('ERC777JoinPolicy', wallets[0])

            stakedContract = await ERC777JoinPolicy.deploy(
                token.address,
                streamRegistryV3.address,
                streamId,
                [
                    PermissionType.Publish, PermissionType.Subscribe
                ],
                1, // minRequiredBalance
                delegatedAccessRegistry.address,
                true // stakingEnabled
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

        it ('should exercise the stakeIn method, happy-path', async () => {
            const tokenBalance = BigNumber.from(10)
            await token.mint(mainWallet.address, tokenBalance)
            const balance = await token.balanceOf(mainWallet.address)
            expect(balance).to.equal(tokenBalance)
            await token.connect(mainWallet).authorizeOperator(stakedContract.address)
            await stakedContract.connect(mainWallet)
            .stakeIn(
                tokenBalance,
                delegatedWallet.address,
                {from: mainWallet.address}
            )
            
            const afterBalance = await token.balanceOf(mainWallet.address)
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

        it ('should exercise the stakeOut, happy-path', async () => {
            const initialBalance = await token.balanceOf(mainWallet.address)
            expect(initialBalance).to.equal(0)

            const contractBalance = await token.balanceOf(stakedContract.address)
            expect(contractBalance).to.equal(10)

            await stakedContract.connect(mainWallet).stakeOut(
                10,
                delegatedWallet.address,
                {from: mainWallet.address}
            )

            const afterBalance = await token.balanceOf(mainWallet.address)
            expect(afterBalance).to.equal(10)
        })
    })*/

})