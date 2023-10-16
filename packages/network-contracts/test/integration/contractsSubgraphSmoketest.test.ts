import { Logger, TheGraphClient } from "@streamr/utils"
import { config } from "@streamr/config"
import fetch from "node-fetch"
import { expect } from "chai"

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
            operatorDailyBuckets {
                id
            }
            sponsorshipDailyBuckets {
                id
            }
            stakingEvents {
                id
            }
            sponsoringEvents {
                id
            }
            delegations {
                id
            }
            nodes {
                id
            }
            operators {
                id
            }
            sponsorships {
                id
            }
            stakes {
                id
            }
            streamPermissions {
                id
            }
            streams {
                id
            }
            delegations {
                delegatedDataWei
                operatorTokenBalanceWei
            }
        }
        `})
        expect(resultDynamicIds.nodes.length).to.equal(1)
        expect(resultDynamicIds.sponsorships.length).to.equal(1)
        expect(resultDynamicIds.sponsorshipDailyBuckets.length).to.equal(1)
        expect(resultDynamicIds.sponsoringEvents.length).to.equal(1)

        expect(resultDynamicIds.stakingEvents.length).to.equal(4)
        expect(resultDynamicIds.operatorDailyBuckets.length).to.equal(3)
        expect(resultDynamicIds.delegations.length).to.equal(3)
        expect(resultDynamicIds.operators.length).to.equal(3)
        expect(resultDynamicIds.stakes.length).to.equal(3)

        expect(resultDynamicIds.streams.length).to.equal(5)
        expect(resultDynamicIds.streamPermissions.length).to.equal(11)

        expect(resultDynamicIds.delegations[0].delegatedDataWei).to.equal("5003000000000000000000")
        expect(resultDynamicIds.delegations[0].operatorTokenBalanceWei).to.equal("5003000000000000000000")
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
