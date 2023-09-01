import { Logger, TheGraphClient } from "@streamr/utils"
import { config } from "@streamr/config"
import fetch from "node-fetch"
import { expect } from "chai"

describe("docker image integration test", () => {

    let graphClient: TheGraphClient

    before(async () => {
        graphClient = new TheGraphClient({
            serverUrl: config.dev2.theGraphUrl,
            fetch,
            logger: new Logger(module)
        })
    })

    it("can get all the indexed example data from thegraph", async () => {

        const resultFixedIds = await graphClient.queryEntity<{ operator: { flagsTargeted: any[] } }>({ query: `
        {
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
        }
        `})
        expect(resultFixedIds).to.deep.equal({
            "delegations": [
                {
                    "id": "0x139dfa493a45364b598f2f98e504192819082c85-0xa3d1f77acff0060f7213d7bf3c7fec78df847de1"
                }
            ],
            "nodes": [
                {
                    "id": "0xde1112f631486cfc759a50196853011528bc5fa0"
                }
            ],
            "operators": [
                {
                    "id": "0x139dfa493a45364b598f2f98e504192819082c85"
                }
            ],
            "sponsorships": [
                {
                    "id": "0xf248372d794e889bb923411e78a78a7f6c1e093d"
                }
            ],
            "stakes": [
                {
                    "id": "0xf248372d794e889bb923411e78a78a7f6c1e093d-0x139dfa493a45364b598f2f98e504192819082c85"
                }
            ],
            "streamPermissions": [
                {
                    "id": "0x139dfa493a45364b598f2f98e504192819082c85/operator/coordination-0x0000000000000000000000000000000000000000"
                },
                {
                    "id": "0x139dfa493a45364b598f2f98e504192819082c85/operator/coordination-0x139dfa493a45364b598f2f98e504192819082c85"
                },
                {
                    "id": "0xa3d1f77acff0060f7213d7bf3c7fec78df847de1/testStream-0xa3d1f77acff0060f7213d7bf3c7fec78df847de1"
                },
                {
                    "id": "0xde1112f631486cfc759a50196853011528bc5fa0/assignments-0x0000000000000000000000000000000000000000"
                },
                {
                    "id": "0xde1112f631486cfc759a50196853011528bc5fa0/assignments-0xde1112f631486cfc759a50196853011528bc5fa0"
                }
            ],
            "streams": [
                {
                    "id": "0x139dfa493a45364b598f2f98e504192819082c85/operator/coordination"
                },
                {
                    "id": "0xa3d1f77acff0060f7213d7bf3c7fec78df847de1/testStream"
                },
                {
                    "id": "0xde1112f631486cfc759a50196853011528bc5fa0/assignments"
                }
            ]
        })

        const resultDynamicIds = await graphClient.queryEntity<{ 
        operatorDailyBuckets: [],
        sponsorshipDailyBuckets: [],
        stakingEvents: [],
        sponsoringEvents: []
     }>({ query: `
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
        }
        `})
        expect(resultDynamicIds.operatorDailyBuckets.length).to.be.greaterThan(0)
        expect(resultDynamicIds.sponsorshipDailyBuckets.length).to.be.greaterThan(0)
        expect(resultDynamicIds.stakingEvents.length).to.be.greaterThan(0)
        expect(resultDynamicIds.sponsoringEvents.length).to.be.greaterThan(0)
    })
})
