import { Logger, TheGraphClient } from "@streamr/utils"
import { config } from "@streamr/config"
import fetch from "node-fetch"
import { expect } from "chai"
import { BigNumber } from "ethers"

describe("docker image integration test", () => {

    let graphClient: TheGraphClient
    let duGraphClient: TheGraphClient

    before(async () => {
        graphClient = new TheGraphClient({
            serverUrl: config.dev2.theGraphUrl,
            fetch,
            logger: new Logger(module)
        })
        duGraphClient = new TheGraphClient({
            serverUrl: config.dev2.theGraphUrl.replace("network-subgraphs", "dataunion"),
            fetch,
            logger: new Logger(module)
        })
    })

    it("can get all the indexed example data from thegraph", async () => {
        const resultDynamicIds = await graphClient.queryEntity<any>({ query: `
        {
            sponsorships {
                id,
                maxOperators
            }
            sponsorshipDailyBuckets {
                id
            }
            sponsoringEvents {
                id
            }
            nodes {
                id
            }
            operators {
                id
            }
            operatorDailyBuckets {
                id
            }
            stakingEvents {
                id
            }
            stakes {
                id
            }
            delegations {
                id
            }
            streams {
                id
            }
            streamPermissions {
                id
            }
            delegations {
                valueDataWei
                operatorTokenBalanceWei
            }
        }
        `})
        expect(resultDynamicIds.sponsorships.length).to.equal(1)
        expect(resultDynamicIds.sponsorships[0].maxOperators).to.equal(3)
        expect(resultDynamicIds.sponsorshipDailyBuckets.length).to.equal(1)
        expect(resultDynamicIds.sponsoringEvents.length).to.equal(1)
        expect(resultDynamicIds.nodes.length).to.equal(1)

        expect(resultDynamicIds.operators.length).to.equal(3)
        expect(resultDynamicIds.operatorDailyBuckets.length).to.equal(3)
        expect(resultDynamicIds.stakingEvents.length).to.equal(4) // 3 operators staked + 1 got kicked out
        expect(resultDynamicIds.stakes.length).to.equal(2) // 3 operators staked - 1 got kicked out
        expect(resultDynamicIds.delegations.length).to.equal(3) // notice how delegations != stakes

        // 3 operator coordination streams, each has 3 permissions (public + owner + ?)
        // 1 storage node assignment stream, each has 2 permissions (public + owner)
        // 1 test stream, only owner permission
        expect(resultDynamicIds.streams.length).to.equal(5)
        expect(resultDynamicIds.streamPermissions.length).to.equal(12) // 3*3 + 2 + 1

        expect(resultDynamicIds.delegations[0].valueDataWei).to.equal("5003000000000000000000")
        expect(resultDynamicIds.delegations[0].operatorTokenBalanceWei).to.equal("5003000000000000000000")
    })

    it("can get indexed network values", async () => {
        const resultDynamicIds = await graphClient.queryEntity<any>({ query: `{
            networks {
                totalStake
                totalDelegated
                totalUndelegated
                sponsorshipsCount
                fundedSponsorshipsCount
                operatorsCount
                eligibleVotersCount
                slashingFraction
                earlyLeaverPenaltyWei
                minimumSelfDelegationFraction
                minimumDelegationWei
                maxPenaltyPeriodSeconds
                maxQueueSeconds
                maxAllowedEarningsFraction
                fishermanRewardFraction
                protocolFeeFraction
                protocolFeeBeneficiary
                minEligibleVoterAge
                minEligibleVoterFractionOfAllStake
                flagReviewerCount
                flagReviewerRewardWei
                flaggerRewardWei
                flagReviewerSelectionIterations
                flagStakeWei
                reviewPeriodSeconds
                votingPeriodSeconds
                flagProtectionSeconds
                randomOracle
                trustedForwarder
                sponsorshipFactory
                operatorFactory
                voterRegistry
                operatorContractOnlyJoinPolicy
                streamRegistryAddress
                minimumStakeWei
            }
        }`})
        expect(resultDynamicIds.networks.length).to.equal(1)
        expect(resultDynamicIds.networks[0].totalStake).to.equal("10006000000000000000000")
        expect(BigNumber.from(resultDynamicIds.networks[0].totalDelegated).gt(0)).to.be.true // unable to do exact comparison due to time dependence
        expect(resultDynamicIds.networks[0].totalUndelegated).to.equal("0")
        expect(resultDynamicIds.networks[0].sponsorshipsCount).to.equal(1)
        expect(resultDynamicIds.networks[0].fundedSponsorshipsCount).to.equal(0)
        expect(resultDynamicIds.networks[0].operatorsCount).to.equal(3)
        expect(resultDynamicIds.networks[0].eligibleVotersCount).to.equal(2)
        // StreamrConfig values
        expect(resultDynamicIds.networks[0].slashingFraction).to.equal("100000000000000000") // 0.1
        expect(resultDynamicIds.networks[0].earlyLeaverPenaltyWei).to.equal("5000000000000000000000") // 5000
        expect(resultDynamicIds.networks[0].minimumSelfDelegationFraction).to.equal("50000000000000000") // 0.05
        expect(resultDynamicIds.networks[0].minimumDelegationWei).to.equal("1000000000000000000") // 1
        expect(resultDynamicIds.networks[0].maxPenaltyPeriodSeconds).to.equal(1209600) // 14 days
        expect(resultDynamicIds.networks[0].maxQueueSeconds).to.equal(2592000) // 30 days
        expect(resultDynamicIds.networks[0].maxAllowedEarningsFraction).to.equal("50000000000000000") // 0.05
        expect(resultDynamicIds.networks[0].fishermanRewardFraction).to.equal("250000000000000000") // 0.25
        expect(resultDynamicIds.networks[0].protocolFeeFraction).to.equal("50000000000000000") // 0.05
        expect(resultDynamicIds.networks[0].protocolFeeBeneficiary).to.equal("0xa3d1f77acff0060f7213d7bf3c7fec78df847de1") // first hardhat account
        expect(resultDynamicIds.networks[0].minEligibleVoterAge).to.equal(0)
        expect(resultDynamicIds.networks[0].minEligibleVoterFractionOfAllStake).to.equal("5000000000000000") // 0.005
        expect(resultDynamicIds.networks[0].flagReviewerCount).to.equal(7)
        expect(resultDynamicIds.networks[0].flagReviewerRewardWei).to.equal("20000000000000000000") // 20
        expect(resultDynamicIds.networks[0].flaggerRewardWei).to.equal("360000000000000000000") // 360
        expect(resultDynamicIds.networks[0].flagReviewerSelectionIterations).to.equal(20)
        expect(resultDynamicIds.networks[0].flagStakeWei).to.equal("500000000000000000000") // 500
        expect(resultDynamicIds.networks[0].reviewPeriodSeconds).to.equal(3600) // 1 hour
        expect(resultDynamicIds.networks[0].votingPeriodSeconds).to.equal(900) // 15 minutes
        expect(resultDynamicIds.networks[0].flagProtectionSeconds).to.equal(3600) // 1 hour
        expect(resultDynamicIds.networks[0].randomOracle).to.equal(null) // TODO: not yet implemented
        expect(resultDynamicIds.networks[0].trustedForwarder).to.equal(null) // TODO: not yet supported
        expect(resultDynamicIds.networks[0].sponsorshipFactory).to.equal(config.dev2.contracts.SponsorshipFactory.toLowerCase())
        expect(resultDynamicIds.networks[0].operatorFactory).to.equal(config.dev2.contracts.OperatorFactory.toLowerCase())
        expect(resultDynamicIds.networks[0].voterRegistry).to.equal(config.dev2.contracts.OperatorFactory.toLowerCase())
        expect(resultDynamicIds.networks[0].operatorContractOnlyJoinPolicy).to.equal(null) // TODO: must be fixed ASAP
        expect(resultDynamicIds.networks[0].streamRegistryAddress).to.equal(config.dev2.contracts.StreamRegistry.toLowerCase())
        expect(resultDynamicIds.networks[0].minimumStakeWei).to.equal("5000000000000000000000") // 5000
    })

    it("can get indexed example flagging", async () => {
        const resultDynamicIds = await graphClient.queryEntity<any>({ query: `{
            operators {
                flagsOpened {
                    result
                }
                flagsTargeted {
                    result
                }
                votesOnFlags {
                    votedKick
                }
            }
            votes {
                voterWeight
                votedKick
            }
        }`})
        expect(new Set(resultDynamicIds.operators.map((o: any) => `${o.flagsOpened.length}/${o.flagsTargeted.length}/${o.votesOnFlags.length}`)))
            .to.deep.equal(new Set(["0/0/1", "1/0/0", "0/1/0"]))
        expect(resultDynamicIds.votes).to.deep.equal([{
            "voterWeight": "5003000000000000000000",
            "votedKick": true,
        }])
    })

    it("can get all the projects from thegraph", async () => {
        const resultDynamicIds = await graphClient.queryEntity<{
        projects: []
     }>({ query: `
        {
            projects {
                id
            }
        }
        `})
        expect(resultDynamicIds.projects.length).to.equal(5)
    })

    // TODO: move this to DU repository?
    it("can get all the indexed example data from Data Union subgraph", async () => {
        const resultDynamicIds = await duGraphClient.queryEntity<{
            dataUnionStatsBuckets: [],
            dataUnions: [],
            members: [],
        }>({ query: `{
                dataUnionStatsBuckets {
                    id
                }
                dataUnions {
                    id
                }
                members {
                    id
                }
            }`}
        )
        expect(resultDynamicIds.dataUnionStatsBuckets.length).to.equal(2)
        expect(resultDynamicIds.dataUnions.length).to.equal(1)
        expect(resultDynamicIds.members.length).to.equal(2)
    })
})
