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

        const result = await graphClient.queryEntity<{ operator: { flagsTargeted: any[] } }>({ query: `
        {
            delegations {
              id
            }
            nodes {
              id
            }
            operatorDailyBuckets {
              id
            }
            operators {
              id
            }
            sponsoringEvents {
              id
            }
            sponsorshipDailyBuckets {
              id
            }
            sponsorships {
              id
            }
            stakes {
              id
            }
            stakingEvents {
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
        expect(result).to.deep.equal({
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
            "operatorDailyBuckets": [
                {
                    "id": "0x139dfa493a45364b598f2f98e504192819082c85-1693267200"
                }
            ],
            "operators": [
                {
                    "id": "0x139dfa493a45364b598f2f98e504192819082c85"
                }
            ],
            "sponsoringEvents": [
                {
                    "id": "0xf248372d794e889bb923411e78a78a7f6c1e093d0xe42549de096cc143f7363a2dd07a0bad539b9af71c166be2720d309c46a8ad0c"
                }
            ],
            "sponsorshipDailyBuckets": [
                {
                    "id": "0xf248372d794e889bb923411e78a78a7f6c1e093d-1693267200"
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
            "stakingEvents": [
                {
                    "id": "0xf248372d794e889bb923411e78a78a7f6c1e093d-0xc224d08060a9f33132e62bb42a23d1d555c221d05dcbc48780fcda0470daecf2"
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
    })
})
