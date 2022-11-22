import { upgrades, ethers } from 'hardhat'
import { expect } from 'chai'
import { BigNumber, Contract} from 'ethers'

import type { MinimalForwarder } from '../../typechain/@openzeppelin/contracts/metatx/MinimalForwarder'
import type { StreamRegistry } from '../../typechain/contracts/StreamRegistry'
import {sign, hash, createIdentity} from 'eth-crypto'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

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
describe('ERC20JoinPolicy', async (): Promise<void> => {
    let wallets: SignerWithAddress[]
    let token: any 
    let contract: Contract

    let streamRegistryV3: StreamRegistry
    let minimalForwarderFromUser0: MinimalForwarder
    let adminAddress: string

    const streamPath = '/foo/bar'
    let streamId: string

    let delegatedAccessRegistry: Contract

    const signerIdentity = createIdentity()

    before(async (): Promise<void> => {
        wallets = await ethers.getSigners()
        adminAddress = wallets[0].address
        streamId = `${adminAddress}${streamPath}`.toLowerCase()

        const minimalForwarderFromUser0Factory = await ethers.getContractFactory('MinimalForwarder', wallets[9])
        minimalForwarderFromUser0 = await minimalForwarderFromUser0Factory.deploy() as MinimalForwarder
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

        const ERC20JoinPolicy = await ethers.getContractFactory('ERC20JoinPolicy', wallets[0])

        const DelegatedAccessRegistry = await ethers.getContractFactory('DelegatedAccessRegistry')
        delegatedAccessRegistry = await DelegatedAccessRegistry.deploy()

        contract = await ERC20JoinPolicy.deploy(
            token.address,
            streamRegistryV3.address,
            streamId,
            [
                PermissionType.Publish, PermissionType.Subscribe
            ],
            1, // minRequiredBalance
            delegatedAccessRegistry.address
        )

        await streamRegistryV3.grantPermission(
            streamId,
            contract.address,
            PermissionType.Grant
        )

        await streamRegistryV3.getPermissionsForUser(
            streamId,
            wallets[0].address
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
        const ERC20JoinPolicy = await ethers.getContractFactory('ERC20JoinPolicy', wallets[0])
        await expect(ERC20JoinPolicy.deploy(
            token.address,
            streamRegistryV3.address,
            streamId,
            [
                PermissionType.Publish, PermissionType.Subscribe
            ],
            0, // minRequiredBalance
            delegatedAccessRegistry.address
        )).to.be.revertedWith('error_minReqBalanceGt0')
    })

    it ('should fail to grant permissions if account is not authorized on DelegatedAccessRegistry', async () => {
        try {
            await contract.requestDelegatedJoin(wallets[2].address)
        } catch (e: any) {
            expect(e.message).to.equal('VM Exception while processing transaction: reverted with reason string \'error_notAuthorized\'')
        }
    })

    it('should fail to grant permissions if not enough balance found', async (): Promise<void> => {
        try {
            const balance = await token.balanceOf(wallets[1].address)
            expect(balance).to.equal(BigNumber.from(0))

            await contract.connect(wallets[1])
                .requestDelegatedJoin(
                    signerIdentity.address,
                    {from: wallets[1].address}
                )  
        } catch (e: any){
            expect(e.message).to.equal("VM Exception while processing transaction: reverted with reason string 'error_notEnoughTokens'")
        }
    })

    it ('should grant 1 token to a user and fullfil their requestDelegatedJoin', async () => {
        await token.mint(wallets[1].address, BigNumber.from(1))
        const balance = await token.balanceOf(wallets[1].address)
        expect(balance).to.equal(BigNumber.from(1))

        await contract.connect(wallets[1])
            .requestDelegatedJoin(
                signerIdentity.address,
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

})