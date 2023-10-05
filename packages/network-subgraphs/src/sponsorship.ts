import { log, BigInt } from '@graphprotocol/graph-ts'

import {
    StakeUpdate,
    SponsorshipUpdate,
    FlagUpdate,
    Flagged,
    ProjectedInsolvencyUpdate,
    OperatorSlashed,
    SponsorshipReceived
} from '../generated/templates/Sponsorship/Sponsorship'
import { Sponsorship, Stake, Flag, SlashingEvent, StakingEvent, SponsoringEvent, Operator } from '../generated/schema'
import { loadOrCreateSponsorshipDailyBucket } from './helpers'

let flagResultStrings = [
    "waiting",
    "voting",
    "kicked",
    "failed"
]

export function handleStakeUpdated(event: StakeUpdate): void {
    let sponsorshipAddress = event.address.toHexString()
    let operatorAddress = event.params.operator.toHexString()
    let stakedWei = event.params.stakedWei
    let earningsWei = event.params.earningsWei
    let lockedStakeWei = event.params.lockedStakeWei
    let now = event.block.timestamp.toU32()
    log.info('handleStakeUpdated: sponsorship={} operator={} stakedWei={} earningsWei={}, lockedStake={} now={}',
        [sponsorshipAddress, operatorAddress, stakedWei.toString(), earningsWei.toString(), now.toString()])

    let stake = loadOrCreateStake(sponsorshipAddress, operatorAddress)
    if (stake.joinTimestamp == 0) { stake.joinTimestamp = now }
    stake.updateTimestamp = now
    stake.amountWei = stakedWei
    stake.earningsWei = earningsWei
    stake.lockedWei = lockedStakeWei
    stake.save()

    // also save StakingEvent, TODO: do we need them?
    let stakingEvent = new StakingEvent(sponsorshipAddress + "-" + event.transaction.hash.toHexString())
    stakingEvent.sponsorship = sponsorshipAddress
    stakingEvent.operator = operatorAddress
    stakingEvent.date = event.block.timestamp
    stakingEvent.amount = event.params.stakedWei
    stakingEvent.save()
}

export function handleSponsorshipUpdated(event: SponsorshipUpdate): void {
    log.info('handleSponsorshipUpdated: totalStakedWei={} remainingWei={} operatorCount={} isRunning={}', [
        event.params.totalStakedWei.toString(), event.params.remainingWei.toString(),
        event.params.operatorCount.toString(), event.params.isRunning.toString()
    ])

    let sponsorshipAddress = event.address.toHexString()
    let sponsorship = Sponsorship.load(sponsorshipAddress)!

    // TODO: should !isRunning mean APY is zero?
    let spotAPY = BigInt.zero()
    if (sponsorship.totalPayoutWeiPerSec > BigInt.zero() && sponsorship.totalStakedWei.gt(BigInt.zero())) {
        spotAPY = sponsorship.totalPayoutWeiPerSec.times(BigInt.fromI32(60 * 60 * 24 * 365)).div(sponsorship.totalStakedWei)
    }

    sponsorship.totalStakedWei = event.params.totalStakedWei
    sponsorship.remainingWei = event.params.remainingWei
    sponsorship.operatorCount = event.params.operatorCount.toI32()
    sponsorship.isRunning = event.params.isRunning
    sponsorship.spotAPY = spotAPY
    sponsorship.save()

    const bucket = loadOrCreateSponsorshipDailyBucket(sponsorshipAddress, event.block.timestamp)
    bucket.totalStakedWei = event.params.totalStakedWei
    bucket.remainingWei = event.params.remainingWei
    bucket.operatorCount = event.params.operatorCount.toI32()
    bucket.spotAPY = spotAPY
    bucket.save()
}

export function handleProjectedInsolvencyUpdate(event: ProjectedInsolvencyUpdate): void {
    log.info('handleProjectedInsolvencyUpdate: sidechainaddress={} projectedInsolvency={}',
        [event.address.toHexString(), event.params.projectedInsolvencyTimestamp.toString()])

    let sponsorshipAddress = event.address.toHexString()
    let sponsorship = Sponsorship.load(sponsorshipAddress)!
    sponsorship.projectedInsolvency = event.params.projectedInsolvencyTimestamp
    sponsorship.save()

    const bucket = loadOrCreateSponsorshipDailyBucket(sponsorshipAddress, event.block.timestamp)
    bucket.projectedInsolvency = event.params.projectedInsolvencyTimestamp
    bucket.save()
}

export function handleFlagged(event: Flagged): void {
    let sponsorship = event.address.toHexString()
    let target = event.params.target.toHexString()
    let flagger = event.params.flagger.toHexString()
    let voteStartTimestamp = event.params.voteStartTimestamp
    let targetStakeAtRiskWei = event.params.targetStakeAtRiskWei
    let flagMetadata = event.params.flagMetadata
    log.info('handleFlagged: sponsorship={} flagger={} target={} voteStartTimestamp={} targetStakeAtRiskWei={} flagMetadata={}',
        [ sponsorship, flagger, target, voteStartTimestamp.toString(), targetStakeAtRiskWei.toString(), flagMetadata ])

    let stake = loadOrCreateStake(sponsorship, target)
    let flagIndex = stake.flagCount
    stake.flagCount = stake.flagCount + 1
    stake.save()

    let flag = new Flag(sponsorship + "-" + target + "-" + flagIndex.toString())
    flag.sponsorship = sponsorship
    flag.target = target
    flag.result = "waiting"
    flag.flagger = flagger
    flag.targetStakeAtRiskWei = targetStakeAtRiskWei
    flag.metadata = flagMetadata
    flag.save()
}

export function handleFlagUpdate(event: FlagUpdate): void {
    let sponsorship = event.address.toHexString()
    let target = event.params.target.toHexString()
    let statusCode = event.params.status.toU32()
    let votesForKick = event.params.votesForKick.toU32()
    let votesAgainstKick = event.params.votesAgainstKick.toU32()
    let totalReviewers = event.params.totalReviewers.toU32()
    log.info('handleFlagUpdate: sponsorship={} target={} status={}, votesFor={} votesAgainst={} reviewers={}',
        [ sponsorship, target, statusCode.toString(), votesForKick.toString(), votesAgainstKick.toString(), totalReviewers.toString() ])

    let stake = loadOrCreateStake(sponsorship, target)
    let flagIndex = stake.flagCount - 1

    let flag = Flag.load(sponsorship + "-" + target + "-" + flagIndex.toString())!
    flag.result = flagResultStrings[statusCode]
    flag.reviewerCount = totalReviewers
    // to break ties, first voter only gets 1 vote, next ones get 2
    flag.votesForKick = (votesForKick + 1) >> 1
    flag.votesAgainstKick = (votesAgainstKick + 1) >> 1
    flag.save()
}

export function handleOperatorSlashed(event: OperatorSlashed): void {
    let sponsorshipAddress = event.address.toHexString()
    let operatorAddress = event.params.operator.toHexString()
    let slashingAmount = event.params.amountWei
    log.info('handleOperatorSlashed: sponsorship={} operator={} slashingAmount={}',
        [ sponsorshipAddress, operatorAddress, slashingAmount.toString() ])

    let slashID = sponsorshipAddress + "-" + event.transaction.hash.toHexString()
    let slashingEvent = new SlashingEvent(slashID)
    slashingEvent.sponsorship = sponsorshipAddress
    slashingEvent.operator = operatorAddress
    slashingEvent.date = event.block.timestamp
    slashingEvent.amount = slashingAmount
    slashingEvent.save()

    // update Operator
    let operator = Operator.load(operatorAddress)
    if (operator !== null) {
        operator.slashingsCount = operator.slashingsCount + 1
        operator.save()
    }
}

export function handleSponsorshipReceived(event: SponsorshipReceived): void {
    log.info('handleSponsorshipReceived: sponsor={} amount={}', [event.params.sponsor.toHexString(),
        event.params.amount.toString()
    ])
    let sponsorship = Sponsorship.load(event.address.toHexString())
    sponsorship!.cumulativeSponsoring = sponsorship!.cumulativeSponsoring.plus(event.params.amount)
    sponsorship!.save()

    let sponsoringEvent = new SponsoringEvent(event.address.toHexString() + event.transaction.hash.toHexString())
    sponsoringEvent.sponsorship = event.address.toHexString()
    sponsoringEvent.sponsor = event.params.sponsor.toHexString()
    sponsoringEvent.date = event.block.timestamp
    sponsoringEvent.amount = event.params.amount
    sponsoringEvent.save()
}

// Stake is the "many-to-many table" between Sponsorship and Operator
function loadOrCreateStake(sponsorshipAddress: string, operatorAddress: string): Stake {
    let stakeID = sponsorshipAddress + "-" + operatorAddress
    let stake = Stake.load(stakeID)
    if (stake === null) {
        stake = new Stake(stakeID)
        stake.sponsorship = sponsorshipAddress
        stake.operator = operatorAddress
        stake.flagCount = 0
        stake.joinTimestamp = 0 // set this in StakeUpdate
    }
    return stake
}
