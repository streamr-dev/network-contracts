import { BigDecimal, BigInt, Bytes, json, JSONValue, JSONValueKind, log, Result } from "@graphprotocol/graph-ts"
import {
    Delegation,
    Operator,
    OperatorDailyBucket,
    Project,
    ProjectStakeByUser,
    ProjectStakingDayBucket,
    Sponsorship,
    SponsorshipDailyBucket
} from '../generated/schema'

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

export function loadOrCreateSponsorshipDailyBucket(
    sponsorshipAddress: string,
    timestamp: BigInt,
): SponsorshipDailyBucket {
    let date = getBucketStartDate(timestamp)
    let bucketId = sponsorshipAddress + "-" + date.toString()
    let bucket = SponsorshipDailyBucket.load(bucketId)
    if (bucket === null) {
        log.info("loadOrCreateSponsorshipDailyBucket: creating new bucketId={}", [bucketId])
        let sponsorship = Sponsorship.load(sponsorshipAddress)
        bucket = new SponsorshipDailyBucket(bucketId)
        bucket.sponsorship = sponsorshipAddress
        bucket.date = date
        bucket.projectedInsolvency = sponsorship!.projectedInsolvency
        bucket.totalStakedWei = sponsorship!.totalStakedWei
        bucket.unallocatedWei = sponsorship!.unallocatedWei
        bucket.spotAPY = sponsorship!.spotAPY
        bucket.save()
    }
    return bucket
}

export function loadOrCreateOperator(operatorId: string): Operator {
    let operator = Operator.load(operatorId)
    if (operator == null) {
        operator = new Operator(operatorId)
        operator.delegatorCount = 0
        operator.poolValue = BigInt.fromI32(0)
        operator.totalValueInSponsorshipsWei = BigInt.fromI32(0)
        operator.freeFundsWei = BigInt.fromI32(0)
        operator.poolValueTimestamp = BigInt.fromI32(0)
        operator.poolValueBlockNumber = BigInt.fromI32(0)
        operator.poolTokenTotalSupplyWei = BigInt.fromI32(0)
        operator.exchangeRate = BigDecimal.fromString("0")
        operator.slashingsCount = 0
        operator.nodes = []

        // populated in handleMetadataUpdated, emitted from Operator.initialize()
        operator.owner = ""
        operator.metadataJsonString = ""
    }
    return operator
}

export function loadOrCreateOperatorDailyBucket(contractAddress: string, timestamp: BigInt): OperatorDailyBucket {
    let date = getBucketStartDate(timestamp)
    let bucketId = contractAddress + "-" + date.toString()
    let bucket = OperatorDailyBucket.load(bucketId)
    if (bucket == null) {
        // absolute values, set at bucket creation time
        bucket = new OperatorDailyBucket(bucketId)
        bucket.operator = contractAddress
        bucket.date = date

        // populate with current absolute values from Operator entity
        let operator = loadOrCreateOperator(contractAddress)
        bucket.poolValue = operator.poolValue
        bucket.totalValueInSponsorshipsWei = operator.totalValueInSponsorshipsWei
        bucket.freeFundsWei = operator.freeFundsWei
        bucket.spotAPY = BigInt.fromI32(0) // TODO
        bucket.delegatorCountAtStart = operator.delegatorCount

        // accumulated values, updated when events are fired
        bucket.delegatorCountChange = 0
        bucket.totalDelegatedWei = BigInt.fromI32(0)
        bucket.totalUndelegatedWei = BigInt.fromI32(0)
        bucket.profitsWei = BigInt.fromI32(0)
        bucket.lossesWei = BigInt.fromI32(0)
        bucket.operatorsShareWei = BigInt.fromI32(0)
    }
    return bucket
}

export function loadOrCreateDelegation(operatorContractAddress: string, delegator: string, timestamp: BigInt): Delegation {
    let delegationId = operatorContractAddress + "-" + delegator
    let delegation = Delegation.load(delegationId)
    if (delegation == null) {
        delegation = new Delegation(delegationId)
        delegation.operator = operatorContractAddress
        delegation.delegator = delegator
        delegation.poolTokenWei = BigInt.fromI32(0)

        // creating a Delegation means a new delegator has joined the operator => increase delegator count
        let operator = loadOrCreateOperator(operatorContractAddress)
        operator.delegatorCount = operator.delegatorCount + 1
        operator.save()

        let operatorDailyBucket = loadOrCreateOperatorDailyBucket(operatorContractAddress, timestamp)
        operatorDailyBucket.delegatorCountChange = operatorDailyBucket.delegatorCountChange + 1
        operatorDailyBucket.save()
    }

    return delegation
}

export function getBucketStartDate(timestamp: BigInt): BigInt {
    return timestamp.minus(timestamp.mod(BUCKET_SECONDS))
}
