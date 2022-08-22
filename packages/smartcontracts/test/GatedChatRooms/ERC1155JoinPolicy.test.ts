import { waffle, upgrades, ethers } from 'hardhat'
import { expect, use } from 'chai'
import { BigNumber, Contract} from 'ethers'

import ForwarderJson from '../../test-contracts/MinimalForwarder.json'
import type { MinimalForwarder } from '../../test-contracts/MinimalForwarder'
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
            [ TokenIds.A, TokenIds.B, TokenIds.C],
            [1, 2, 3], // minRequiredBalance    
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
    })

    it('should fail to grant permissions if not enough balance found', async (): Promise<void> => {
        try {
            const balance = await token.balanceOf(wallets[1].address, TokenIds.A)
            expect(balance).to.equal(BigNumber.from(0))

            await contract.connect(wallets[0])
                .requestDelegatedJoin(
                    signerIdentity.address,
                    TokenIds.A,
                    {from: wallets[0].address}
                )  
        } catch (e: any){
            expect(e.message).to.equal("VM Exception while processing transaction: reverted with reason string 'Not enough tokens'")
        }
    })

    it ('should check and fail when a user has not enough balance upon canJoin', async () => {
        const canJoin = await contract.canJoin(wallets[1].address, TokenIds.A)
        expect(canJoin).to.equal(false)
    })

    it ('should check positively that a user can request join', async () => {
        await token.mint(wallets[0].address, TokenIds.A, BigNumber.from(1))
        const canJoin = await contract.canJoin(wallets[0].address, TokenIds.A)
        expect(canJoin).to.equal(true)
    })
    
    it ('should grant 1 token to a user and fullfil their requestDelegatedJoin', async () => {
        const balance = await token.balanceOf(wallets[0].address, TokenIds.A)
        expect(balance).to.equal(BigNumber.from(1))
            
        await contract.connect(wallets[0])
            .requestDelegatedJoin(
                signerIdentity.address,
                TokenIds.A,
                {from: wallets[0].address}
            )

        const events = await contract.queryFilter(
            contract.filters.Accepted()
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