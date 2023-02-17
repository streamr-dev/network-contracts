import { Bytes, Value } from "@graphprotocol/graph-ts"
import { assert, clearStore, describe, test, beforeAll } from "matchstick-as/assembly/index"
import { Staking, Unstaking } from "../generated/schema"
import {
    handleStake, handleUnstake
} from "../src/projectStaking"
import {
    createStakeEvent, createUnstakeEvent,
} from "./helpers/mocked-event"
import {
    createProjectEntity,
    createStakingEntity,
    createUnstakingEntity,
} from "./helpers/mocked-entity"

// handlers need to be exported from the test file when running test coverage
export {
    handleStake,
    handleUnstake,
} from "../src/projectStaking"

const PROJECT_ENTITY_TYPE = "Project"
const STAKING_ENTITY_TYPE = "Staking"
const UNSTAKING_ENTITY_TYPE = "Unstaking"

describe("Entity stores", () => {
    const projectId = "0x1234"
    const user = "0x7986b71c27b6eaab3120a984f26511b2dcfe3fb4"
    const newUser = "0xd8da6bf26964af9d7eed9e03e53415d37aa96045" // vitalik.eth
    const stakingId = "0x1234-0x7986b71c27b6eaab3120a984f26511b2dcfe3fb4-1" // projectId-userId-counter
    const unstakingId = "0x1234-0x7986b71c27b6eaab3120a984f26511b2dcfe3fb4-2" // projectId-userId-counter
    const amount = 200
    const stakedAt = 20000001
    const unstakedAt = 20000002

    beforeAll(() => {
        clearStore()
    })

    test("Staking - entity created", () => {
        createStakingEntity(stakingId, projectId, user, amount, stakedAt)
        assert.entityCount(STAKING_ENTITY_TYPE, 1)
        assert.fieldEquals(STAKING_ENTITY_TYPE, stakingId, "id", stakingId)
    })

    test("Staking - entity retreived from the store using entity.load()", () => {
        const retrievedStaking = Staking.load(stakingId)
        assert.stringEquals(stakingId, retrievedStaking!.get("id")!.toString())
    })

    test("Staking - entity can be updated using entity.save()", () => {
        const staking = Staking.load(stakingId) as Staking
        staking.set("user", Value.fromString(newUser))
        staking.save()
        assert.fieldEquals(STAKING_ENTITY_TYPE, stakingId, "user", newUser)
    })

    test("Staking - returns null when calling entity.load() if entity doesn't exist", () => {
        const retrievedStaking = Staking.load("IDoNotExist")
        assert.assertNull(retrievedStaking)
    })

    test("Unstaking - entity created", () => {
        createUnstakingEntity(unstakingId, projectId, user, amount, unstakedAt)
        assert.entityCount(UNSTAKING_ENTITY_TYPE, 1)
        assert.fieldEquals(UNSTAKING_ENTITY_TYPE, unstakingId, "id", unstakingId)
    })

    test("Unstaking - entity retreived from the store using entity.load()", () => {
        const retrievedUnstaking = Unstaking.load(unstakingId)
        assert.stringEquals(unstakingId, retrievedUnstaking!.get("id")!.toString())
    })

    test("Unstaking - returns null when calling entity.load() if entity doesn't exist", () => {
        const retrievedUnstaking = Unstaking.load("IDoNotExist")
        assert.assertNull(retrievedUnstaking)
    })

    test("Unstaking - entity can be updated using entity.save()", () => {
        const unstaking = Unstaking.load(unstakingId) as Unstaking
        unstaking.set("user", Value.fromString(newUser))
        unstaking.save()
        assert.fieldEquals(UNSTAKING_ENTITY_TYPE, unstakingId, "user", newUser)
    })
})

describe("Mocked ProjectStakingV1 Events: Staking & Unstaking", () => {
    const projectId = "0x123456"
    const user = "0x7986b71c27b6eaab3120a984f26511b2dcfe3fb4"
    const stakingId = "0x123456-0x7986b71c27b6eaab3120a984f26511b2dcfe3fb4-1" // projectId-user-counter
    const unstakingId = "0x123456-0x7986b71c27b6eaab3120a984f26511b2dcfe3fb4-2" // projectId-user-counter
    const stakingAmount = 200
    const unstakingAmount = 50
    
    beforeAll(() => {
        clearStore()
    })

    test("Project Entity created", () => {
        createProjectEntity(projectId)
        assert.entityCount(PROJECT_ENTITY_TYPE, 1)
        assert.fieldEquals(PROJECT_ENTITY_TYPE, projectId, "id", projectId)
    })

    test("handleStake", () => {
        const event = createStakeEvent(Bytes.fromHexString(projectId), user, stakingAmount)

        handleStake(event)

        assert.entityCount(STAKING_ENTITY_TYPE, 1)
        assert.fieldEquals(STAKING_ENTITY_TYPE, stakingId, "id", stakingId)
        assert.fieldEquals(STAKING_ENTITY_TYPE, stakingId, "user", user)
        assert.fieldEquals(STAKING_ENTITY_TYPE, stakingId, "amount", `${stakingAmount}`)
    })

    test("handleUnstake", () => {
        const event = createUnstakeEvent(Bytes.fromHexString(projectId), user, unstakingAmount)

        handleUnstake(event)

        assert.entityCount(UNSTAKING_ENTITY_TYPE, 1)
        assert.fieldEquals(UNSTAKING_ENTITY_TYPE, unstakingId, "id", unstakingId)
        assert.fieldEquals(UNSTAKING_ENTITY_TYPE, unstakingId, "user", user)
        assert.fieldEquals(UNSTAKING_ENTITY_TYPE, unstakingId, "amount", `${unstakingAmount}`)
    })
})
