import { log, BigInt, BigDecimal, store } from '@graphprotocol/graph-ts'

import {
    StakeUpdate,
    StakeLockUpdate,
    SponsorshipUpdate,
    FlagUpdate,
    Flagged,
    OperatorSlashed,
    SponsorshipReceived,
    InsolvencyStarted,
    InsolvencyEnded
} from '../generated/templates/Sponsorship/Sponsorship'
import { Sponsorship, Stake, Flag, Vote, SlashingEvent, StakingEvent, SponsoringEvent, Operator } from '../generated/schema'
import { loadOrCreateNetwork, loadOrCreateFlag, loadOrCreateOperator, loadOrCreateSponsorshipDailyBucket } from './helpers'

const flagResultStrings = [
    "waiting",
    "voting",
    "kicked",
    "failed"
]

export function handleStakeUpdated(event: StakeUpdate): void {
    const sponsorshipId = event.address.toHexString()
    const operatorId = event.params.operator.toHexString()
    const stakedWei = event.params.stakedWei
    const earningsWei = event.params.earningsWei
    const now = event.block.timestamp.toU32()
    log.info('handleStakeUpdated: sponsorship={} operator={} stakedWei={} earningsWei={}, now={}',
        [sponsorshipId, operatorId, stakedWei.toString(), earningsWei.toString(), now.toString()])

    const stake = loadOrCreateStake(sponsorshipId, operatorId)
    if (stakedWei == BigInt.zero()) {
        store.remove('Stake', stake.id)
        return
    }
    if (stake.joinTimestamp == 0) { stake.joinTimestamp = now }
    stake.updateTimestamp = now
    stake.amountWei = stakedWei
    stake.earningsWei = earningsWei
    stake.save()

    // also save StakingEvent, TODO: do we need them?
    const stakingEvent = new StakingEvent(sponsorshipId + "-" + event.transaction.hash.toHexString())
    stakingEvent.sponsorship = sponsorshipId
    stakingEvent.operator = operatorId
    stakingEvent.date = event.block.timestamp
    stakingEvent.amount = event.params.stakedWei
    stakingEvent.save()
}

export function handleStakeLockUpdated(event: StakeLockUpdate): void {
    const sponsorshipId = event.address.toHexString()
    const operatorId = event.params.operator.toHexString()
    const lockedStakeWei = event.params.lockedStakeWei
    const minimumStakeWei = event.params.minimumStakeWei
    log.info('handleStakeLockUpdated: sponsorship={} operator={} lockedStakeWei={} minimumStakeWei={}',
        [sponsorshipId, operatorId, lockedStakeWei.toString(), minimumStakeWei.toString()])

    const stake = loadOrCreateStake(sponsorshipId, operatorId)
    stake.lockedWei = lockedStakeWei
    stake.minimumStakeWei = minimumStakeWei
    stake.save()
}

export function handleSponsorshipUpdated(event: SponsorshipUpdate): void {
    log.info('handleSponsorshipUpdated: totalStakedWei={} remainingWei={} operatorCount={} isRunning={}', [
        event.params.totalStakedWei.toString(), event.params.remainingWei.toString(),
        event.params.operatorCount.toString(), event.params.isRunning.toString()
    ])

    const sponsorshipId = event.address.toHexString()
    const sponsorship = Sponsorship.load(sponsorshipId)!
    sponsorship.totalStakedWei = event.params.totalStakedWei
    sponsorship.remainingWei = event.params.remainingWei
    sponsorship.remainingWeiUpdateTimestamp = event.block.timestamp
    sponsorship.operatorCount = event.params.operatorCount.toI32()
    sponsorship.isRunning = event.params.isRunning

    // Calculate spotAPY and projectedInsolvency ASSUMING that the sponsorship is paying i.e. ignore isRunning
    // This makes the values more useful for sorting the sponsorships: not-yet-running but funded will show up on top
    if (sponsorship.remainingWei > BigInt.zero() && sponsorship.totalPayoutWeiPerSec > BigInt.zero()) {
        const remainingSeconds = sponsorship.remainingWei / sponsorship.totalPayoutWeiPerSec
        sponsorship.projectedInsolvency = remainingSeconds + event.block.timestamp

        // Also, to handle the case where sponsorship doesn't have any stakers yet, add minimum stake for the "maximal APY *after* staking"
        const SECONDS_IN_YEAR = BigInt.fromI32(60 * 60 * 24 * 365)
        const network = loadOrCreateNetwork()
        const annualPayout = sponsorship.totalPayoutWeiPerSec * SECONDS_IN_YEAR
        const totalStakeAfterStaking = sponsorship.totalStakedWei + network.minimumStakeWei
        sponsorship.spotAPY = annualPayout.toBigDecimal() / totalStakeAfterStaking.toBigDecimal()
    } else {
        sponsorship.spotAPY = BigDecimal.zero()
        // projectedInsolvency is left unchanged, so that if the sponsorship runs out, projectedInsolvency shows when it did
    }
    sponsorship.save()

    const bucket = loadOrCreateSponsorshipDailyBucket(sponsorship, event.block.timestamp)
    bucket.totalStakedWei = sponsorship.totalStakedWei
    bucket.remainingWei = sponsorship.remainingWei
    bucket.operatorCount = sponsorship.operatorCount
    // only update spotAPY if we weren't out of money, to leave the last "good" value into the bucket
    //   otherwise, in historical data, the last day APY would always be zero (for the whole day)
    if (sponsorship.spotAPY > BigDecimal.zero()) {
        bucket.spotAPY = sponsorship.spotAPY
    }
    bucket.save()
}

export function handleInsolvencyStarted(event: InsolvencyStarted): void {
    const sponsorshipId = event.address.toHexString()
    const startTimestamp = event.params.startTimeStamp.toHexString()
    log.info('handleInsolvencyStarted: sponsorship={} startTimestamp={} blockNumber={}',
        [sponsorshipId, startTimestamp, event.block.number.toString()])
    const network = loadOrCreateNetwork()
    network.fundedSponsorshipsCount += 1
    network.save()
}

export function handleInsolvencyEnded(event: InsolvencyEnded): void {
    const sponsorshipId = event.address.toHexString()
    const endTimestamp = event.params.endTimeStamp.toHexString()
    log.info('handleInsolvencyEnded: sponsorship={} endTimeStamp={} blockNumber={}',
        [sponsorshipId, endTimestamp, event.block.number.toString()])
    const network = loadOrCreateNetwork()
    network.fundedSponsorshipsCount -= 1
    network.save()
}

export function handleFlagged(event: Flagged): void {
    const sponsorshipId = event.address.toHexString()
    const targetId = event.params.target.toHexString()
    const flaggerId = event.params.flagger.toHexString()
    const targetStakeAtRiskWei = event.params.targetStakeAtRiskWei
    const reviewerCount = event.params.reviewerCount.toI32()
    const flagMetadata = event.params.flagMetadata
    const now = event.block.timestamp.toI32()
    log.info('handleFlagged: sponsorship={} flagger={} target={} targetStakeAtRiskWei={} reviewerCount={} flagMetadata={} now={}',
        [ sponsorshipId, flaggerId, targetId, targetStakeAtRiskWei.toString(), reviewerCount.toString(), flagMetadata, now.toString() ])

    // keep the running flagIndex in the first flag, set it to always point to the latest flag
    // the reason why first flag is a good place is that there is a list of flags per Operator-Sponsorship pair,
    //   however Stake (which would be the natural place since it represents such pair) isn't a good place for the running index
    //   because when a vote concludes with VOTE_KICK (or Operator unstakes for whatever reason) the Stake entity is deleted
    const firstFlag = loadOrCreateFlag(sponsorshipId, targetId, 0) // loaded here, created in operator.handleReviewRequest
    const flagIndex = firstFlag.lastFlagIndex + 1
    firstFlag.lastFlagIndex = flagIndex
    firstFlag.save()

    const flag = loadOrCreateFlag(sponsorshipId, targetId, flagIndex) // loaded here, created in operator.handleReviewRequest
    flag.flagger = flaggerId
    flag.flaggingTimestamp = now
    flag.reviewerCount = reviewerCount
    flag.targetStakeAtRiskWei = targetStakeAtRiskWei
    flag.metadata = flagMetadata
    flag.lastFlagIndex = 0 // only the first flag will have this value updated (and if this is the first flag, 0 is the correct value)
    const network = loadOrCreateNetwork()
    flag.voteStartTimestamp = flag.flaggingTimestamp + network.reviewPeriodSeconds
    flag.voteEndTimestamp = flag.voteStartTimestamp + network.votingPeriodSeconds
    flag.protectionEndTimestamp = flag.voteEndTimestamp + network.flagProtectionSeconds
    flag.save()
}

export function handleFlagUpdate(event: FlagUpdate): void {
    const sponsorshipId = event.address.toHexString()
    const targetAddress = event.params.target
    const targetId = targetAddress.toHexString()
    const statusCode = event.params.status
    const votesForKick = event.params.votesForKick
    const votesAgainstKick = event.params.votesAgainstKick
    const voterId = event.params.voter.toHexString()
    const weight = event.params.voterWeight.abs()
    const votedKick = event.params.voterWeight.gt(BigInt.zero())
    const now = event.block.timestamp.toI32()
    log.info('handleFlagUpdate: sponsorship={} target={} status={}, voter={}, vote={}, weight={}, votesFor={} votesAgainst={}', [
        sponsorshipId, targetId, statusCode.toString(), voterId, votedKick ? "kick" : "no kick", weight.toString(),
        votesForKick.toString(), votesAgainstKick.toString()
    ])

    const flagIndex = Flag.load(sponsorshipId + "-" + targetId + "-0")!.lastFlagIndex
    const flag = Flag.load(sponsorshipId + "-" + targetId + "-" + flagIndex.toString())!
    flag.result = flagResultStrings[statusCode]
    if (flag.result == "failed") {
        const targetOperator = loadOrCreateOperator(targetAddress)
        targetOperator.protectionEndTimestamp = flag.protectionEndTimestamp
    }
    if (flag.result == "kicked" || flag.result == "failed") {
        flag.flagResolutionTimestamp = now
    }
    flag.votesForKick = votesForKick
    flag.votesAgainstKick = votesAgainstKick
    flag.save()

    if (weight.gt(BigInt.zero())) {
        const vote = new Vote(sponsorshipId + "-" + targetId + "-" + flagIndex.toString() + "-" + voterId)
        vote.flag = flag.id
        vote.voter = voterId
        vote.voterWeight = weight
        vote.votedKick = votedKick
        vote.timestamp = now
        vote.save()
    }
}

export function handleOperatorSlashed(event: OperatorSlashed): void {
    const sponsorshipId = event.address.toHexString()
    const operatorId = event.params.operator.toHexString()
    const slashingAmount = event.params.amountWei
    log.info('handleOperatorSlashed: sponsorship={} operator={} slashingAmount={}',
        [ sponsorshipId, operatorId, slashingAmount.toString() ])

    const slashingEventId = sponsorshipId + "-" + event.transaction.hash.toHexString()
    const slashingEvent = new SlashingEvent(slashingEventId)
    slashingEvent.sponsorship = sponsorshipId
    slashingEvent.operator = operatorId
    slashingEvent.date = event.block.timestamp
    slashingEvent.amount = slashingAmount
    slashingEvent.save()

    // update Operator
    const operator = Operator.load(operatorId)
    if (operator !== null) {
        operator.slashingsCount = operator.slashingsCount + 1
        operator.save()
    }
}

export function handleSponsorshipReceived(event: SponsorshipReceived): void {
    const sponsorshipId = event.address.toHexString()
    const sponsorId = event.params.sponsor.toHexString()
    log.info('handleSponsorshipReceived: sponsor={} amount={}', [ sponsorId, event.params.amount.toString() ])
    const sponsorship = Sponsorship.load(sponsorshipId)
    sponsorship!.cumulativeSponsoring = sponsorship!.cumulativeSponsoring.plus(event.params.amount)
    sponsorship!.save()

    const sponsoringEvent = new SponsoringEvent(sponsorshipId + event.transaction.hash.toHexString())
    sponsoringEvent.sponsorship = sponsorshipId
    sponsoringEvent.sponsor = sponsorId
    sponsoringEvent.date = event.block.timestamp
    sponsoringEvent.amount = event.params.amount
    sponsoringEvent.save()
}

// Stake is the "many-to-many table" between Sponsorship and Operator
function loadOrCreateStake(sponsorshipAddress: string, operatorAddress: string): Stake {
    const stakeID = sponsorshipAddress + "-" + operatorAddress
    let stake = Stake.load(stakeID)
    if (stake === null) {
        stake = new Stake(stakeID)
        stake.sponsorship = sponsorshipAddress
        stake.operator = operatorAddress

        // set in handleStakeUpdated
        stake.joinTimestamp = 0
        stake.updateTimestamp = 0
        stake.amountWei = BigInt.zero()
        stake.earningsWei = BigInt.zero()

        // set in handleStakeLockUpdated
        stake.lockedWei = BigInt.zero()
        stake.minimumStakeWei = BigInt.zero() // TODO: populate from global minimum stake once we have the network-stats entity
    }
    return stake
}
