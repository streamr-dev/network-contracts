import { BigInt, Bytes, json, JSONValue, JSONValueKind, log, Result } from "@graphprotocol/graph-ts"
import { Project, ProjectStakeByUser, ProjectStakingDayBucket, SponsorshipDailyBucket } from '../generated/schema'

const BUCKET_SECONDS = BigInt.fromI32(60 * 60 * 24) // 1 day

/**
 * Helper function to load a project or create a project with default values. It will probably silence some errors.
 * @dev toHexString() will automatically lowercase the projectId
 */
export function loadOrCreateProject(projectId: Bytes): Project {
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
        project.stakedWei = BigInt.fromI32(0)
    }
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
        let bucketStakeAtStart = BigInt.fromI32(0)
        let project = Project.load(projectId)
        if (project !== null) {
            bucketStakeAtStart = project.stakedWei
        }
        bucket.stakeAtStart = bucketStakeAtStart
        bucket.stakeChange = BigInt.fromI32(0)
        bucket.stakingsWei = BigInt.fromI32(0)
        bucket.unstakingsWei = BigInt.fromI32(0)
    }
    return bucket
}

export function loadOrCreateProjectStake(projectId: string, user: Bytes): ProjectStakeByUser {
    const projectStakeId = projectId + '-' + user.toHexString()
    let projectStake = ProjectStakeByUser.load(projectStakeId)
    if (projectStake === null) {
        projectStake = new ProjectStakeByUser(projectStakeId)
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

export function updateOrCreateSponsorshipDailyBucket(
    sponsorshipAddress: string,
    timestamp: i32,
    totalStakedWei: BigInt,
    unallocatedWei: BigInt,
    operatorCount: i32,
    projectedInsolvency: BigInt | null,
    totalPayoutWeiPerSec: BigInt | null,
): void {
    let dateString = getDateString(timestamp)
    let bucketId = sponsorshipAddress + "-" + dateString
    let bucket = SponsorshipDailyBucket.load(bucketId)
    if (bucket === null) {
        log.info("updateOrCreateSponsorshipDailyBucket: creating new stat statId={}", [bucketId])
        bucket = new SponsorshipDailyBucket(bucketId)
        bucket.sponsorship = sponsorshipAddress
        bucket.date = BigInt.fromI32(i32((new Date(timestamp)).getTime() / 1000))
        bucket.totalStakedWei = totalStakedWei
        bucket.unallocatedWei = unallocatedWei
        bucket.projectedInsolvency = new BigInt(0)
        bucket.spotAPY = new BigInt(0)
        bucket.totalPayoutsCumulative = new BigInt(0)
    } else {
        bucket.totalStakedWei = bucket.totalStakedWei.plus(totalStakedWei)
        bucket.unallocatedWei = bucket.unallocatedWei.plus(unallocatedWei)
        if (projectedInsolvency !== null) {
            bucket.projectedInsolvency = projectedInsolvency
        }
        if (totalPayoutWeiPerSec !== null) {
            bucket.spotAPY = totalPayoutWeiPerSec.times(BigInt.fromI32(60 * 60 * 24 * 365)).div(bucket.totalStakedWei)
        }
    }
    bucket.operatorCount = operatorCount
    bucket.save()
}

export function updateOrCreateOperatorDailyBucket(): void {
    // TODO
}

export function getDateString(timestamp: i32): string {
    let date = new Date(timestamp)
    date.setUTCHours(0)
    date.setUTCMinutes(0)
    date.setUTCSeconds(0)
    date.setUTCMilliseconds(0)
    //datestring in yyyy-mm-dd format
    return date.toISOString().split('T')[0]
}
