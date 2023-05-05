import { BigInt, Bytes, json, JSONValue, JSONValueKind, log, Result } from "@graphprotocol/graph-ts"
import { OperatorDailyBucket, Project, ProjectStakeByUser, ProjectStakingDayBucket, Sponsorship, SponsorshipDailyBucket } from '../generated/schema'

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
    const bucketStartDate = getBucketStartDate(timestamp)
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
    timestamp: BigInt,
    totalStakedWei: BigInt,
    unallocatedWei: BigInt,
    operatorCount: i32,
    projectedInsolvency: BigInt | null
): void {
    let date = getBucketStartDate(timestamp)
    let bucketId = sponsorshipAddress + "-" + date.toString()
    let bucket = SponsorshipDailyBucket.load(bucketId)
    let sponsorship = Sponsorship.load(sponsorshipAddress)
    if (bucket === null) {
        log.info("updateOrCreateSponsorshipDailyBucket: creating new stat statId={}", [bucketId])
        bucket = new SponsorshipDailyBucket(bucketId)
        bucket.sponsorship = sponsorshipAddress
        bucket.date = date
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
        if (sponsorship && sponsorship.totalPayoutWeiPerSec && bucket.totalStakedWei.gt(BigInt.fromI32(0))) {
            bucket.spotAPY = sponsorship.totalPayoutWeiPerSec.times(BigInt.fromI32(60 * 60 * 24 * 365)).div(bucket.totalStakedWei)
            log.info("updateOrCreateSponsorshipDailyBucket debug1: spotAPY={} totalPayoutWeiPerSec={} totalPayoutWeiPerSec={}",
                [bucket.spotAPY.toString(), sponsorship.totalPayoutWeiPerSec.toString(), bucket.totalStakedWei.toString()])
        }
    }
    bucket.operatorCount = operatorCount
    bucket.save()
}

export function updateOrCreateOperatorDailyBucket(
    contractAddress: string,
    timestamp: BigInt,
    approximatePoolValue: BigInt,
    unallocatedWei: BigInt,
    delegatorCount: i32,
    totalDelegatedWei: BigInt,
    totalStakedWei: BigInt
): void {
    let date = getBucketStartDate(timestamp)
    let bucketId = contractAddress + "-" + date.toString()
    let bucket = OperatorDailyBucket.load(bucketId)
    if (bucket === null) {
        bucket = new OperatorDailyBucket(bucketId)
        bucket.operator = contractAddress
        bucket.date = date
        bucket.approximatePoolValue = BigInt.fromI32(0)
        bucket.unallocatedWei = BigInt.fromI32(0)
        bucket.spotAPY = BigInt.fromI32(0)
        bucket.totalPayoutsCumulative = BigInt.fromI32(0)
        bucket.delegatorCount = 0
        bucket.totalDelegatedWei = BigInt.fromI32(0)
        bucket.totalStakedWei = BigInt.fromI32(0)
    } else {
        bucket.approximatePoolValue = approximatePoolValue
        bucket.unallocatedWei = unallocatedWei
        bucket.delegatorCount = delegatorCount
        bucket.totalDelegatedWei = totalDelegatedWei
        bucket.totalStakedWei = totalStakedWei
    }
    bucket.save()
}

export function getBucketStartDate(timestamp: BigInt): BigInt {
    return timestamp.minus(timestamp.mod(BUCKET_SECONDS))
}
