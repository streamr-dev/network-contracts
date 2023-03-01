import { waffle, ethers } from 'hardhat'
import { expect, use } from 'chai'
import { Contract } from 'ethers'

const { provider } = waffle

use(waffle.solidity)
describe('JoinPolicyRegistry', (): void => {
    const wallets = provider.getWallets()
    const StakingEnabled = false
    const adminAddress: string = wallets[0].address

    const streamPath = '/foo/bar'

    const TokenAddress = '0x000000000000000000000000000000000000cafE'
    const StreamId = `${adminAddress}${streamPath}`.toLowerCase()
    const TokenId = 1234567890
    const DeployedPolicyAddress = '0x0000000000000000000000000000000000000001'

    let CalculatedPolicyId: string

    let joinPolicyRegistry: Contract
    before(async (): Promise<void> => {
        const JoinPolicyRegistry = await ethers.getContractFactory('JoinPolicyRegistry')
        joinPolicyRegistry = await JoinPolicyRegistry.deploy()
    })

    it('should verify that a new instance can be registered positively', async () => {
        const [policyId, canBeRegistered] = await joinPolicyRegistry.canBeRegistered(
            TokenAddress,
            StreamId,
            TokenId,
            StakingEnabled
        )
        expect(canBeRegistered).to.be.true
        expect(policyId).to.not.equal(
            '0x0000000000000000000000000000000000000000000000000000000000000000'
        )
        CalculatedPolicyId = policyId
    })

    it('should positively register a new instance', async () => {
        await joinPolicyRegistry.register(
            TokenAddress,
            StreamId,
            DeployedPolicyAddress,
            TokenId,
            StakingEnabled
        )

        const events = await joinPolicyRegistry.queryFilter(joinPolicyRegistry.filters.Registered())
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

    it('should fail to register an existing instance', async () => {
        await expect(
            joinPolicyRegistry.register(
                TokenAddress,
                StreamId,
                DeployedPolicyAddress,
                TokenId,
                StakingEnabled
            )
        ).to.be.revertedWith('error_alreadyRegistered')
    })

    it('should fetch the deployed policy', async () => {
        const fetchedPolicyAddress = await joinPolicyRegistry.getPolicy(
            TokenAddress,
            TokenId,
            StreamId,
            StakingEnabled
        )

        expect(fetchedPolicyAddress).to.equal(DeployedPolicyAddress)
    })
})
