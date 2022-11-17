import { waffle, upgrades, ethers } from 'hardhat'
import { expect, use } from 'chai'
import { BigNumber, Contract} from 'ethers'

import ForwarderJson from '../../artifacts/@openzeppelin/contracts/metatx/MinimalForwarder.sol/MinimalForwarder.json'
import type { MinimalForwarder } from '../../typechain/MinimalForwarder'
import type { StreamRegistry } from '../../typechain/StreamRegistry'
import {sign, hash, createIdentity} from 'eth-crypto'
import { JoinPolicyRegistry } from '../../typechain'

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
describe('JoinPolicyRegistry', (): void => {
    const wallets = provider.getWallets()
    const StakingEnabled = false
    let streamRegistryV3: StreamRegistry
    let minimalForwarderFromUser0: MinimalForwarder
    const adminAddress: string = wallets[0].address

    const streamPath = '/foo/bar'

    const TokenAddress = '0x000000000000000000000000000000000000cafE'
    const StreamId = `${adminAddress}${streamPath}`.toLowerCase()
    const TokenId = 1234567890
    const DeployedPolicyAddress = '0x0000000000000000000000000000000000000001'

    let CalculatedPolicyId: string 

    let delegatedAccessRegistry: Contract
    let joinPolicyRegistry: Contract
    let deployer: Contract
    let token: Contract
    before( async (): Promise<void> => {
           
        const JoinPolicyRegistry = await ethers.getContractFactory('JoinPolicyRegistry')
        joinPolicyRegistry = await JoinPolicyRegistry.deploy()

    })

    it ('should verify that a new instance can be registered positively', async () => {
        const [policyId, canBeRegistered] = await joinPolicyRegistry.canBeRegistered(
            TokenAddress,
            StreamId,
            TokenId,
            StakingEnabled
        )
        expect(canBeRegistered).to.be.true
        expect(policyId).to.not.equal('0x0000000000000000000000000000000000000000000000000000000000000000')
        CalculatedPolicyId = policyId
    })

    it ('should positively register a new instance', async () => {
        await joinPolicyRegistry.register(
            TokenAddress,
            StreamId,
            DeployedPolicyAddress,
            TokenId,
            StakingEnabled
        )

        const events = await joinPolicyRegistry.queryFilter(
            joinPolicyRegistry.filters.Registered()
        )
        expect(events.length).to.equal(1)
        expect(events[0].args).to.not.be.undefined

        const eventArgs = events[0].args!

        expect(eventArgs.tokenAddress).to.equal(TokenAddress)
        expect(eventArgs.policyAddress).to.equal(DeployedPolicyAddress)
        expect(eventArgs.streamId.hash).to.equal(
            ethers.utils.keccak256(ethers.utils.toUtf8Bytes(StreamId))
        )
        expect(eventArgs.policyId).to.equal(CalculatedPolicyId)
    })

    it ('should fail to register an existing instance', async () => {
        try {
            await joinPolicyRegistry.register(
                TokenAddress,
                StreamId,
                DeployedPolicyAddress,
                TokenId,
                StakingEnabled
            )
        } catch (e: any) {
            expect(e.message).to.equal('VM Exception while processing transaction: reverted with reason string \'error_alreadyRegistered\'')
        }
    })

    it ('should fetch the deployed policy', async() => {
        const fetchedPolicyAddress = await joinPolicyRegistry.getPolicy(
            TokenAddress,
            TokenId,
            StreamId,
            StakingEnabled
        )

        expect(fetchedPolicyAddress).to.equal(DeployedPolicyAddress)
    })
})