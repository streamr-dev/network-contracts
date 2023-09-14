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
        expect(resultDynamicIds.operatorDailyBuckets.length).to.equal(1)
        expect(resultDynamicIds.sponsorshipDailyBuckets.length).to.equal(1)
        expect(resultDynamicIds.stakingEvents.length).to.equal(1)
        expect(resultDynamicIds.sponsoringEvents.length).to.equal(1)
        expect(resultDynamicIds.delegations.length).to.equal(1)
        expect(resultDynamicIds.nodes.length).to.equal(1)
        expect(resultDynamicIds.operators.length).to.equal(1)
        expect(resultDynamicIds.sponsorships.length).to.equal(1)
        expect(resultDynamicIds.stakes.length).to.equal(1)
        expect(resultDynamicIds.streamPermissions.length).to.equal(5)
        expect(resultDynamicIds.streams.length).to.equal(3)
    })
})
