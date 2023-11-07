import { log, BigInt, BigDecimal, store } from '@graphprotocol/graph-ts'

import {
    StakeUpdate,
    StakeLockUpdate,
    SponsorshipUpdate,
    FlagUpdate,
    Flagged,
    OperatorSlashed,
    SponsorshipReceived
} from '../generated/templates/Sponsorship/Sponsorship'
import { Sponsorship, Stake, Flag, Vote, SlashingEvent, StakingEvent, SponsoringEvent, Operator } from '../generated/schema'
import { loadOrCreateFlag, loadOrCreateSponsorshipDailyBucket } from './helpers'

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
    let now = event.block.timestamp.toU32()
    log.info('handleStakeUpdated: sponsorship={} operator={} stakedWei={} earningsWei={}, now={}',
        [sponsorshipAddress, operatorAddress, stakedWei.toString(), earningsWei.toString(), now.toString()])

    let stake = loadOrCreateStake(sponsorshipAddress, operatorAddress)
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
    let stakingEvent = new StakingEvent(sponsorshipAddress + "-" + event.transaction.hash.toHexString())
    stakingEvent.sponsorship = sponsorshipAddress
    stakingEvent.operator = operatorAddress
    stakingEvent.date = event.block.timestamp
    stakingEvent.amount = event.params.stakedWei
    stakingEvent.save()
}

export function handleStakeLockUpdated(event: StakeLockUpdate): void {
    let sponsorshipAddress = event.address.toHexString()
    let operatorAddress = event.params.operator.toHexString()
    let lockedStakeWei = event.params.lockedStakeWei
    let minimumStakeWei = event.params.minimumStakeWei
    log.info('handleStakeLockUpdated: sponsorship={} operator={} lockedStakeWei={} minimumStakeWei={}',
        [sponsorshipAddress, operatorAddress, lockedStakeWei.toString(), minimumStakeWei.toString()])

    let stake = loadOrCreateStake(sponsorshipAddress, operatorAddress)
    stake.lockedWei = lockedStakeWei
    stake.minimumStakeWei = minimumStakeWei
    stake.save()
}

export function handleSponsorshipUpdated(event: SponsorshipUpdate): void {
    log.info('handleSponsorshipUpdated: totalStakedWei={} remainingWei={} operatorCount={} isRunning={}', [
        event.params.totalStakedWei.toString(), event.params.remainingWei.toString(),
        event.params.operatorCount.toString(), event.params.isRunning.toString()
    ])

    let sponsorshipAddress = event.address.toHexString()
    let sponsorship = Sponsorship.load(sponsorshipAddress)!

    // TODO: should !isRunning mean APY is zero?
    let spotAPY = BigDecimal.zero()
    if (sponsorship.totalPayoutWeiPerSec > BigInt.zero() && sponsorship.totalStakedWei.gt(BigInt.zero())) {
        spotAPY = sponsorship.totalPayoutWeiPerSec.toBigDecimal()
            .times((BigInt.fromI32(60 * 60 * 24 * 365)).toBigDecimal())
            .div(sponsorship.totalStakedWei.toBigDecimal())
    }

    sponsorship.totalStakedWei = event.params.totalStakedWei
    sponsorship.remainingWei = event.params.remainingWei
    sponsorship.remainingWeiUpdateTimestamp = event.block.timestamp
    sponsorship.operatorCount = event.params.operatorCount.toI32()
    sponsorship.isRunning = event.params.isRunning
    sponsorship.spotAPY = spotAPY
    if (!sponsorship.isRunning || sponsorship.totalPayoutWeiPerSec.equals(BigInt.zero())) {
        sponsorship.projectedInsolvency = null
    } else {
        sponsorship.projectedInsolvency = sponsorship.remainingWei.div(sponsorship.totalPayoutWeiPerSec)
            .plus(event.block.timestamp)
    }        
    sponsorship.save()

    const bucket = loadOrCreateSponsorshipDailyBucket(sponsorshipAddress, event.block.timestamp)
    bucket.totalStakedWei = event.params.totalStakedWei
    bucket.remainingWei = event.params.remainingWei
    bucket.operatorCount = event.params.operatorCount.toI32()
    bucket.spotAPY = spotAPY
    bucket.save()
}

export function handleFlagged(event: Flagged): void {
    let sponsorship = event.address.toHexString()
    let target = event.params.target.toHexString()
    let flagger = event.params.flagger.toHexString()
    let targetStakeAtRiskWei = event.params.targetStakeAtRiskWei
    let reviewerCount = event.params.reviewerCount.toI32()
    let flagMetadata = event.params.flagMetadata
    let now = event.block.timestamp.toI32()
    log.info('handleFlagged: sponsorship={} flagger={} target={} targetStakeAtRiskWei={} reviewerCount={} flagMetadata={} now={}',
        [ sponsorship, flagger, target, targetStakeAtRiskWei.toString(), reviewerCount.toString(), flagMetadata, now.toString() ])

    // keep the running flagIndex in the first flag, set it to always point to the latest flag
    // the reason why first flag is a good place is that there is a list of flags per Operator-Sponsorship pair,
    //   however Stake (which would be the natural place since it represents such pair) isn't a good place for the running index
    //   because when a vote concludes with VOTE_KICK (or Operator unstakes for whatever reason) the Stake entity is deleted
    let flagIndex = 0
    let firstFlag = Flag.load(sponsorship + "-" + target + "-0")
    if (firstFlag !== null) {
        flagIndex = firstFlag.lastFlagIndex + 1
        firstFlag.lastFlagIndex = flagIndex
        firstFlag.save()
    }

    let flag = loadOrCreateFlag(sponsorship, target, flagIndex) // will always be a load (ReviewRequest handler does the creation)
    flag.flagger = flagger
    flag.flaggingTimestamp = now
    flag.reviewerCount = reviewerCount
    flag.targetStakeAtRiskWei = targetStakeAtRiskWei
    flag.metadata = flagMetadata
    flag.save()
}

export function handleFlagUpdate(event: FlagUpdate): void {
    let sponsorship = event.address.toHexString()
    let target = event.params.target.toHexString()
    let statusCode = event.params.status
    let votesForKick = event.params.votesForKick
    let votesAgainstKick = event.params.votesAgainstKick
    let voter = event.params.voter.toHexString()
    let weight = event.params.voterWeight.abs()
    let votedKick = event.params.voterWeight.gt(BigInt.zero())
    let now = event.block.timestamp.toI32()
    log.info('handleFlagUpdate: sponsorship={} target={} status={}, voter={}, vote={}, weight={}, votesFor={} votesAgainst={}', [
        sponsorship, target, statusCode.toString(), voter, votedKick ? "kick" : "no kick", weight.toString(),
        votesForKick.toString(), votesAgainstKick.toString()
    ])

    let flagIndex = Flag.load(sponsorship + "-" + target + "-0")!.lastFlagIndex
    let flag = Flag.load(sponsorship + "-" + target + "-" + flagIndex.toString())!
    flag.result = flagResultStrings[statusCode]
    flag.votesForKick = votesForKick
    flag.votesAgainstKick = votesAgainstKick
    flag.save()

    if (weight.gt(BigInt.zero())) {
        let vote = new Vote(sponsorship + "-" + target + "-" + flagIndex.toString() + "-" + voter)
        vote.flag = flag.id
        vote.voter = voter
        vote.voterWeight = weight
        vote.votedKick = votedKick
        vote.timestamp = now
        vote.save()
    }
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
