import { BigInt, Bytes, json, JSONValue, JSONValueKind, Result } from "@graphprotocol/graph-ts"
import { Project, ProjectStake, ProjectStakingDayBucket } from '../generated/schema'

const BUCKET_SECONDS = BigInt.fromI32(60 * 60 * 24) // 1 day

/**
 * Helper function to load a project or create a project with default values. It will probably silence some errors.
 * @dev toHexString() will automatically lowercase the projectId
 */
export function loadOrCreateProject(projectId: Bytes, totalStake: BigInt): Project {
    let project = Project.load(projectId.toHexString())
    if (project == null) {
        project = new Project(projectId.toHexString())
        project.domainIds = []
        project.minimumSubscriptionSeconds = BigInt.fromI32(0)
        project.metadata = ""
        project.streams = []
        project.permissions = []
        project.subscriptions = []
        project.paymentDetails = []
        project.purchases = []
        project.createdAt = BigInt.fromI32(0)
        project.counter = 0
        project.score = BigInt.fromI32(0)
        project.isDataUnion = false
    }
    project.totalStake = totalStake
    return project
}

export function loadOrCreateProjectStakingBucket(projectId: string, timestamp: BigInt): ProjectStakingDayBucket {
    const bucketStartDate = timestamp.minus(timestamp.mod(BUCKET_SECONDS))
    const bucketId = projectId + '-' + bucketStartDate.toString()
    let bucket = ProjectStakingDayBucket.load(bucketId)
    if (bucket === null) {
        bucket = new ProjectStakingDayBucket(bucketId)
        bucket.project = projectId
        bucket.date = bucketStartDate
        bucket.stakeAtStart = BigInt.fromI32(0)
        bucket.stakeChange = BigInt.fromI32(0)
    }
    return bucket
}

export function loadOrCreateProjectStake(projectId: string, user: Bytes): ProjectStake {
    const projectStakeId = projectId + '-' + user.toHexString()
    let projectStake = ProjectStake.load(projectStakeId)
    if (projectStake === null) {
        projectStake = new ProjectStake(projectStakeId)
        projectStake.project = projectId
        projectStake.user = user
        projectStake.userStake = BigInt.fromI32(0)
    }
    return projectStake
}

/**
 * Parse string to JSON and return the value of the "isDataUnion" key.
 * @dev https://thegraph.com/docs/en/developing/assemblyscript-api/#json-api
 */
export function getIsDataUnionValue(jsonString: string): boolean {
    let result: Result<JSONValue, boolean> = json.try_fromString(jsonString)
    if (result.isOk && result.value.kind == JSONValueKind.OBJECT) {
        let resultObj = result.value.toObject()
        let isDataUnionOrNull: JSONValue | null = resultObj.get("isDataUnion")
        return isDataUnionOrNull == null
            ? false
            : isDataUnionOrNull.toBool()
    }
    return false
}
