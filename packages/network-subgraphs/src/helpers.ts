import { BigDecimal, BigInt, Bytes, json, JSONValue, JSONValueKind, log, Result } from "@graphprotocol/graph-ts"
import {
    Delegation,
    Delegator,
    DelegatorDailyBucket,
    Network,
    Flag,
    Operator,
    OperatorDailyBucket,
    Project,
    ProjectStakeByUser,
    ProjectStakingDayBucket,
    Sponsorship,
    SponsorshipDailyBucket
} from '../generated/schema'

const BUCKET_SECONDS = BigInt.fromI32(60 * 60 * 24) // 1 day
const NETWORK_ENTITY_ID = "network-entity-id"

/**
 * Helper function to load a project or create a project with default values. It will probably silence some errors.
 * @dev toHexString() will automatically lowercase the projectId
 */
export function loadOrCreateProject(projectId: Bytes): Project {
    let project = Project.load(projectId.toHexString())
    if (project == null) {
        project = new Project(projectId.toHexString())
        project.domainIds = []
        project.minimumSubscriptionSeconds = BigInt.zero()
        project.metadata = ""
        project.streams = []
        project.permissions = []
        project.subscriptions = []
        project.paymentDetails = []
        project.purchases = []
        project.createdAt = BigInt.zero()
        project.counter = 0
        project.score = BigInt.zero()
        project.isDataUnion = false
        project.stakedWei = BigInt.zero()
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
        let bucketStakeAtStart = BigInt.zero()
        let project = Project.load(projectId)
        if (project !== null) {
            bucketStakeAtStart = project.stakedWei
        }
        bucket.stakeAtStart = bucketStakeAtStart
        bucket.stakeChange = BigInt.zero()
        bucket.stakingsWei = BigInt.zero()
        bucket.unstakingsWei = BigInt.zero()
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
        projectStake.userStake = BigInt.zero()
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

export function loadOrCreateNetwork(): Network {
    let network = Network.load(NETWORK_ENTITY_ID)
    if (network == null) {
        network = new Network(NETWORK_ENTITY_ID)

        network.totalStake = BigInt.zero()
        network.totalDelegated = BigInt.zero()
        network.totalUndelegated = BigInt.zero()
        network.sponsorshipsCount = 0
        network.fundedSponsorshipsCount = 0
        network.operatorsCount = 0
        network.eligibleVotersCount = 0

        network.slashingFraction = BigInt.zero()
        network.earlyLeaverPenaltyWei = BigInt.zero()
        network.minimumDelegationWei = BigInt.zero()
        network.minimumSelfDelegationFraction = BigInt.zero()
        network.maxPenaltyPeriodSeconds = 0
        network.maxQueueSeconds = 0
        network.maxAllowedEarningsFraction = BigInt.zero()
        network.fishermanRewardFraction = BigInt.zero()
        network.protocolFeeFraction = BigInt.zero()
        network.protocolFeeBeneficiary = ''
        network.minEligibleVoterAge = 0
        network.minEligibleVoterFractionOfAllStake = BigInt.zero()
        network.flagReviewerCount = 0
        network.flagReviewerRewardWei = BigInt.zero()
        network.flaggerRewardWei = BigInt.zero()
        network.flagReviewerSelectionIterations = 0
        network.flagStakeWei = BigInt.zero()
        network.reviewPeriodSeconds = 0
        network.votingPeriodSeconds = 0
        network.flagProtectionSeconds = 0
        network.randomOracle = ''
        network.trustedForwarder = ''
        network.sponsorshipFactory = ''
        network.operatorFactory = ''
        network.voterRegistry = ''
        network.operatorContractOnlyJoinPolicy = ''
        network.streamRegistryAddress = ''
        network.minimumStakeWei = BigInt.zero()
    }
    return network
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
        bucket.remainingWei = sponsorship!.remainingWei
        bucket.spotAPY = sponsorship!.spotAPY
        bucket.operatorCount = sponsorship!.operatorCount
    }
    return bucket
}

export function loadOrCreateFlag(sponsorshipAddress: string, targetAddress: string, flagIndex: i32): Flag {
    let flagId = sponsorshipAddress + "-" + targetAddress + "-" + flagIndex.toString()
    let flag = Flag.load(flagId)
    if (flag === null) {
        flag = new Flag(flagId)
        flag.lastFlagIndex = -1 // only the first flag use this value; and if this is the first flag, 0 is the correct value after +1
        flag.sponsorship = sponsorshipAddress
        flag.target = targetAddress
        flag.flagger = ""
        flag.flaggingTimestamp = 0
        flag.result = "waiting"
        flag.flagResolutionTimestamp = 0
        flag.votesForKick = BigInt.zero()
        flag.votesAgainstKick = BigInt.zero()
        flag.reviewerCount = 0
        flag.targetStakeAtRiskWei = BigInt.zero()
        flag.metadata = ""
        flag.voteStartTimestamp = 0
        flag.voteEndTimestamp = 0
        flag.protectionEndTimestamp = 0
        flag.reviewers = []
    }
    return flag
}

export function loadOrCreateOperator(operatorId: string): Operator {
    let operator = Operator.load(operatorId)
    if (operator == null) {
        operator = new Operator(operatorId)
        operator.delegatorCount = 0
        operator.valueWithoutEarnings = BigInt.zero()
        operator.totalStakeInSponsorshipsWei = BigInt.zero()
        operator.dataTokenBalanceWei = BigInt.zero()
        operator.valueUpdateTimestamp = BigInt.zero()
        operator.valueUpdateBlockNumber = BigInt.zero()
        operator.operatorTokenTotalSupplyWei = BigInt.zero()
        operator.cumulativeProfitsWei = BigInt.zero()
        operator.cumulativeEarningsWei = BigInt.zero()
        operator.cumulativeOperatorsCutWei = BigInt.zero()
        operator.exchangeRate = BigDecimal.fromString("0")
        operator.slashingsCount = 0
        operator.nodes = []

        operator.isEligibleToVote = false
        
        // populated in handleMetadataUpdated, emitted from Operator.initialize()
        operator.owner = ""
        operator.metadataJsonString = ""
        operator.operatorsCutFraction = BigInt.zero()
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
        bucket.valueWithoutEarnings = operator.valueWithoutEarnings
        bucket.totalStakeInSponsorshipsWei = operator.totalStakeInSponsorshipsWei
        bucket.dataTokenBalanceWei = operator.dataTokenBalanceWei
        bucket.delegatorCountAtStart = operator.delegatorCount
        bucket.cumulativeEarningsWei = operator.cumulativeEarningsWei

        // accumulated values, updated when events are fired
        bucket.delegatorCountChange = 0
        bucket.totalDelegatedWei = BigInt.zero()
        bucket.totalUndelegatedWei = BigInt.zero()
        bucket.profitsWei = BigInt.zero()
        bucket.lossesWei = BigInt.zero()
        bucket.operatorsCutWei = BigInt.zero()
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
        delegation.valueDataWei = BigInt.zero()
        delegation.operatorTokenBalanceWei = BigInt.zero()
    }

    return delegation
}

export function loadOrCreateDelegator(delegator: string): Delegator {
    let delegatorEntity = Delegator.load(delegator)
    if (delegatorEntity == null) {
        log.info("loadOrCreateDelegator: creating new delegator={}", [delegator])
        delegatorEntity = new Delegator(delegator)
        delegatorEntity.numberOfDelegations = 0
        delegatorEntity.totalValueDataWei = BigInt.zero()
        delegatorEntity.cumulativeEarningsWei = BigInt.zero()
    }
    return delegatorEntity
}

export function loadOrCreateDelegatorDailyBucket(delegator: Delegator, timestamp: BigInt): DelegatorDailyBucket {
    let date = getBucketStartDate(timestamp)
    let bucketId = delegator.id + "-" + date.toString()
    let bucket = DelegatorDailyBucket.load(bucketId)
    if (bucket == null) {
        bucket = new DelegatorDailyBucket(bucketId)
        bucket.delegator = delegator.id
        bucket.date = date
        bucket.totalValueDataWei = BigInt.zero()
        bucket.operatorCount = 0
        bucket.cumulativeEarningsWei = delegator.cumulativeEarningsWei
    }
    return bucket
}

export function getBucketStartDate(timestamp: BigInt): BigInt {
    return timestamp.minus(timestamp.mod(BUCKET_SECONDS))
}
