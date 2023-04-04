import { Bytes, Value } from "@graphprotocol/graph-ts"
import { assert, clearStore, describe, test, beforeAll } from "matchstick-as/assembly/index"
import { ProjectStake } from "../generated/schema"
import {
    handleStake, handleUnstake
} from "../src/projectStaking"
import {
    createStakeEvent, createUnstakeEvent,
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
const PROJECT_STAKE_ENTITY_TYPE = "ProjectStake"

describe("Entity stores", () => {
    const projectId = "0x1234"
    const user = "0x7986b71c27b6eaab3120a984f26511b2dcfe3fb4"
    const newUser = "0xd8da6bf26964af9d7eed9e03e53415d37aa96045" // vitalik.eth
    const stakingId = "0x1234-0x7986b71c27b6eaab3120a984f26511b2dcfe3fb4" // projectId-userAddress

    beforeAll(() => {
        clearStore()
    })

    test("ProjectStake - entity created", () => {
        createProjectStakeEntity(stakingId, projectId, user)
        assert.entityCount(PROJECT_STAKE_ENTITY_TYPE, 1)
        assert.fieldEquals(PROJECT_STAKE_ENTITY_TYPE, stakingId, "id", stakingId)
    })

    test("ProjectStake - entity retreived from the store using entity.load()", () => {
        const retrievedStaking = ProjectStake.load(stakingId)
        assert.stringEquals(stakingId, retrievedStaking!.get("id")!.toString())
    })

    test("ProjectStake - entity can be updated using entity.save()", () => {
        const staking = ProjectStake.load(stakingId) as ProjectStake
        staking.set("user", Value.fromString(newUser))
        staking.save()
        assert.fieldEquals(PROJECT_STAKE_ENTITY_TYPE, stakingId, "user", newUser)
    })

    test("ProjectStake - returns null when calling entity.load() if entity doesn't exist", () => {
        const retrievedProjectStake = ProjectStake.load("IDoNotExist")
        assert.assertNull(retrievedProjectStake)
    })
})

describe("Mocked ProjectStakingV1 Events: Stake & Unstake", () => {
    const projectId = "0x123456"
    const user = "0x7986b71c27b6eaab3120a984f26511b2dcfe3fb4"
    const stakingId = "0x123456-0x7986b71c27b6eaab3120a984f26511b2dcfe3fb4" // projectId-userAddress
    const stakingAmount = 200
    const unstakingAmount = 50
    const totalStake = 1000 // all tokens staked in contract
    
    beforeAll(() => {
        clearStore()
    })

    test("Project Entity created", () => {
        createProjectEntity(projectId)
        assert.entityCount(PROJECT_ENTITY_TYPE, 1)
        assert.fieldEquals(PROJECT_ENTITY_TYPE, projectId, "id", projectId)
    })

    test("handleStake", () => {
        const event = createStakeEvent(Bytes.fromHexString(projectId), user, stakingAmount, totalStake)

        handleStake(event)

        assert.entityCount(PROJECT_STAKE_ENTITY_TYPE, 1)
        assert.fieldEquals(PROJECT_STAKE_ENTITY_TYPE, stakingId, "id", stakingId)
        assert.fieldEquals(PROJECT_STAKE_ENTITY_TYPE, stakingId, "user", user)
        assert.fieldEquals(PROJECT_STAKE_ENTITY_TYPE, stakingId, "userStake", `${stakingAmount}`)
        // totalStake is given by the Stake event, it's not caluclated by the handler
        assert.fieldEquals(PROJECT_ENTITY_TYPE, projectId, "totalStake", `${totalStake}`)
    })

    test("handleUnstake", () => {
        const event = createUnstakeEvent(Bytes.fromHexString(projectId), user, unstakingAmount, totalStake)

        handleUnstake(event)

        assert.entityCount(PROJECT_STAKE_ENTITY_TYPE, 1)
        assert.fieldEquals(PROJECT_STAKE_ENTITY_TYPE, stakingId, "id", stakingId)
        assert.fieldEquals(PROJECT_STAKE_ENTITY_TYPE, stakingId, "user", user)
        assert.fieldEquals(PROJECT_STAKE_ENTITY_TYPE, stakingId, "userStake", `${stakingAmount - unstakingAmount}`)
        // totalStake is given by the Unstake event, it's not caluclated by the handler
        assert.fieldEquals(PROJECT_ENTITY_TYPE, projectId, "totalStake", `${totalStake}`)
    })
})
