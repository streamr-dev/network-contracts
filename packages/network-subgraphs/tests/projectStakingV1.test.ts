import { Bytes, Value } from "@graphprotocol/graph-ts"
import { assert, clearStore, describe, test, beforeAll } from "matchstick-as/assembly/index"
import { ProjectStakeByUser } from "../generated/schema"
import {
    handleStake1, handleUnstake1
} from "../src/projectStaking"
import {
    createStake1Event, createUnstake1Event,
} from "./helpers/mocked-event"
import {
    createProjectEntity,
    createProjectStakeEntity,
} from "./helpers/mocked-entity"

// handlers need to be exported from the test file when running test coverage
export {
    handleStake,
    handleUnstake,
} from "../src/projectStaking"

const PROJECT_ENTITY_TYPE = "Project"
const PROJECT_STAKE_ENTITY_TYPE = "ProjectStakeByUser"
const PROJECT_STAKING_DAY_BUCKET_ENTITY_TYPE = "ProjectStakingDayBucket"

describe("Entity stores", () => {
    const projectId = "0x1234"
    const user = "0x7986b71c27b6eaab3120a984f26511b2dcfe3fb4"
    const newUser = "0xd8da6bf26964af9d7eed9e03e53415d37aa96045" // vitalik.eth
    const stakingId = "0x1234-0x7986b71c27b6eaab3120a984f26511b2dcfe3fb4" // projectId-userAddress

    beforeAll(() => {
        clearStore()
    })

    test("ProjectStakeByUser - entity created", () => {
        createProjectStakeEntity(stakingId, projectId, user)
        assert.entityCount(PROJECT_STAKE_ENTITY_TYPE, 1)
        assert.fieldEquals(PROJECT_STAKE_ENTITY_TYPE, stakingId, "id", stakingId)
    })

    test("ProjectStakeByUser - entity retreived from the store using entity.load()", () => {
        const retrievedStaking = ProjectStakeByUser.load(stakingId)
        assert.stringEquals(stakingId, retrievedStaking!.get("id")!.toString())
    })

    test("ProjectStakeByUser - entity can be updated using entity.save()", () => {
        const staking = ProjectStakeByUser.load(stakingId) as ProjectStakeByUser
        staking.set("user", Value.fromString(newUser))
        staking.save()
        assert.fieldEquals(PROJECT_STAKE_ENTITY_TYPE, stakingId, "user", newUser)
    })

    test("ProjectStakeByUser - returns null when calling entity.load() if entity doesn't exist", () => {
        const retrievedProjectStake = ProjectStakeByUser.load("IDoNotExist")
        assert.assertNull(retrievedProjectStake)
    })
})

describe("Mocked ProjectStakingV1 Events: Stake & Unstake", () => {
    const projectId = "0x123456"
    const user = "0x7986b71c27b6eaab3120a984f26511b2dcfe3fb4"
    const stakingId = "0x123456-0x7986b71c27b6eaab3120a984f26511b2dcfe3fb4" // projectId-userAddress
    const stakingAmount = 200
    const unstakingAmount = 50
    const projectStake = 1000 // all tokens staked for projectId
    const bucketDate = "0"
    const bucketId = "0x123456-0" // projectId-bucketDate
    
    beforeAll(() => {
        clearStore()
    })

    test("Project Entity created", () => {
        createProjectEntity(projectId)
        assert.entityCount(PROJECT_ENTITY_TYPE, 1)
        assert.fieldEquals(PROJECT_ENTITY_TYPE, projectId, "id", projectId)
    })

    test("handleStake1", () => {
        const event = createStake1Event(Bytes.fromHexString(projectId), user, stakingAmount, projectStake)

        handleStake1(event)

        assert.entityCount(PROJECT_STAKE_ENTITY_TYPE, 1)
        assert.fieldEquals(PROJECT_STAKE_ENTITY_TYPE, stakingId, "id", stakingId)
        assert.fieldEquals(PROJECT_STAKE_ENTITY_TYPE, stakingId, "user", user)
        assert.fieldEquals(PROJECT_STAKE_ENTITY_TYPE, stakingId, "userStake", `${stakingAmount}`)
        // projectStake is given by the Stake event, it's not caluclated by the handler
        assert.fieldEquals(PROJECT_ENTITY_TYPE, projectId, "stakedWei", `${projectStake}`)

        assert.entityCount(PROJECT_STAKING_DAY_BUCKET_ENTITY_TYPE, 1)
        assert.fieldEquals(PROJECT_STAKING_DAY_BUCKET_ENTITY_TYPE, bucketId, "id", bucketId)
        assert.fieldEquals(PROJECT_STAKING_DAY_BUCKET_ENTITY_TYPE, bucketId, "project", projectId)
        assert.fieldEquals(PROJECT_STAKING_DAY_BUCKET_ENTITY_TYPE, bucketId, "date", `${bucketDate}`)
        assert.fieldEquals(PROJECT_STAKING_DAY_BUCKET_ENTITY_TYPE, bucketId, "stakeAtStart", `${0}`)
        assert.fieldEquals(PROJECT_STAKING_DAY_BUCKET_ENTITY_TYPE, bucketId, "stakeChange", `${stakingAmount}`)
        assert.fieldEquals(PROJECT_STAKING_DAY_BUCKET_ENTITY_TYPE, bucketId, "stakingsWei", `${stakingAmount}`)
        assert.fieldEquals(PROJECT_STAKING_DAY_BUCKET_ENTITY_TYPE, bucketId, "unstakingsWei", `${0}`)

    })

    test("handleUnstake1", () => {
        const event = createUnstake1Event(Bytes.fromHexString(projectId), user, unstakingAmount, projectStake)

        handleUnstake1(event)

        assert.entityCount(PROJECT_STAKE_ENTITY_TYPE, 1)
        assert.fieldEquals(PROJECT_STAKE_ENTITY_TYPE, stakingId, "id", stakingId)
        assert.fieldEquals(PROJECT_STAKE_ENTITY_TYPE, stakingId, "user", user)
        assert.fieldEquals(PROJECT_STAKE_ENTITY_TYPE, stakingId, "userStake", `${stakingAmount - unstakingAmount}`)
        // projectStake is given by the Unstake event, it's not caluclated by the handler
        assert.fieldEquals(PROJECT_ENTITY_TYPE, projectId, "stakedWei", `${projectStake}`)

        assert.entityCount(PROJECT_STAKING_DAY_BUCKET_ENTITY_TYPE, 1)
        assert.fieldEquals(PROJECT_STAKING_DAY_BUCKET_ENTITY_TYPE, bucketId, "id", bucketId)
        assert.fieldEquals(PROJECT_STAKING_DAY_BUCKET_ENTITY_TYPE, bucketId, "project", projectId)
        assert.fieldEquals(PROJECT_STAKING_DAY_BUCKET_ENTITY_TYPE, bucketId, "date", `${bucketDate}`)
        assert.fieldEquals(PROJECT_STAKING_DAY_BUCKET_ENTITY_TYPE, bucketId, "stakeAtStart", `${0}`)
        assert.fieldEquals(PROJECT_STAKING_DAY_BUCKET_ENTITY_TYPE, bucketId, "stakeChange", `${stakingAmount - unstakingAmount}`)
        assert.fieldEquals(PROJECT_STAKING_DAY_BUCKET_ENTITY_TYPE, bucketId, "stakingsWei", `${stakingAmount}`)
        assert.fieldEquals(PROJECT_STAKING_DAY_BUCKET_ENTITY_TYPE, bucketId, "unstakingsWei", `${unstakingAmount}`)
    })
})
