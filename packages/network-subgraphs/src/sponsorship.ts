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
    const sponsorshipAddress = event.address.toHexString()
    const operatorAddress = event.params.operator.toHexString()
    const stakedWei = event.params.stakedWei
    const earningsWei = event.params.earningsWei
    const now = event.block.timestamp.toU32()
    log.info('handleStakeUpdated: sponsorship={} operator={} stakedWei={} earningsWei={}, now={}',
        [sponsorshipAddress, operatorAddress, stakedWei.toString(), earningsWei.toString(), now.toString()])

    const stake = loadOrCreateStake(sponsorshipAddress, operatorAddress)
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
    const stakingEvent = new StakingEvent(sponsorshipAddress + "-" + event.transaction.hash.toHexString())
    stakingEvent.sponsorship = sponsorshipAddress
    stakingEvent.operator = operatorAddress
    stakingEvent.date = event.block.timestamp
    stakingEvent.amount = event.params.stakedWei
    stakingEvent.save()
}

export function handleStakeLockUpdated(event: StakeLockUpdate): void {
    const sponsorshipAddress = event.address.toHexString()
    const operatorAddress = event.params.operator.toHexString()
    const lockedStakeWei = event.params.lockedStakeWei
    const minimumStakeWei = event.params.minimumStakeWei
    log.info('handleStakeLockUpdated: sponsorship={} operator={} lockedStakeWei={} minimumStakeWei={}',
        [sponsorshipAddress, operatorAddress, lockedStakeWei.toString(), minimumStakeWei.toString()])

    const stake = loadOrCreateStake(sponsorshipAddress, operatorAddress)
    stake.lockedWei = lockedStakeWei
    stake.minimumStakeWei = minimumStakeWei
    stake.save()
}

export function handleSponsorshipUpdated(event: SponsorshipUpdate): void {
    log.info('handleSponsorshipUpdated: totalStakedWei={} remainingWei={} operatorCount={} isRunning={}', [
        event.params.totalStakedWei.toString(), event.params.remainingWei.toString(),
        event.params.operatorCount.toString(), event.params.isRunning.toString()
    ])

    const sponsorshipAddress = event.address.toHexString()
    const sponsorship = Sponsorship.load(sponsorshipAddress)!
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

        // If the sponsorship is funded for less than a day, then consider that's all the tokens the stakers would ever get.
        // This defends against super high APY numbers for sponsorships that promise to pay out a lot but aren't really funded
        // Also, to handle the case where sponsorship doesn't have any stakers yet, add minimum stake for the "maximal APY *after* staking"
        const SECONDS_IN_DAY = BigInt.fromI32(60 * 60 * 24)
        const SECONDS_IN_YEAR = BigInt.fromI32(60 * 60 * 24 * 365)
        const network = loadOrCreateNetwork()
        const annualPayout = (remainingSeconds < SECONDS_IN_DAY) ? sponsorship.remainingWei : (sponsorship.totalPayoutWeiPerSec * SECONDS_IN_YEAR)
        const totalStakeAfterStaking = sponsorship.totalStakedWei + network.minimumStakeWei
        sponsorship.spotAPY = annualPayout.toBigDecimal() / totalStakeAfterStaking.toBigDecimal()
    } else {
        sponsorship.spotAPY = BigDecimal.zero()
        // projectedInsolvency is left unchanged, so that if the sponsorship runs out, projectedInsolvency shows when it did
    }
    sponsorship.save()

    const bucket = loadOrCreateSponsorshipDailyBucket(sponsorshipAddress, event.block.timestamp)
    bucket.totalStakedWei = sponsorship.totalStakedWei
    bucket.remainingWei = sponsorship.remainingWei
    bucket.operatorCount = sponsorship.operatorCount
    bucket.spotAPY = sponsorship.spotAPY
    bucket.save()
}

export function handleInsolvencyStarted(event: InsolvencyStarted): void {
    const sponsorshipAddress = event.address.toHexString()
    const startTimestamp = event.params.startTimeStamp.toHexString()
    log.info('handleInsolvencyStarted: sponsorship={} startTimestamp={} blockNumber={}',
        [sponsorshipAddress, startTimestamp, event.block.number.toString()])
    const network = loadOrCreateNetwork()
    network.fundedSponsorshipsCount += 1
    network.save()
}

export function handleInsolvencyEnded(event: InsolvencyEnded): void {
    const sponsorshipAddress = event.address.toHexString()
    const endTimestamp = event.params.endTimeStamp.toHexString()
    log.info('handleInsolvencyEnded: sponsorship={} endTimeStamp={} blockNumber={}',
        [sponsorshipAddress, endTimestamp, event.block.number.toString()])
    const network = loadOrCreateNetwork()
    network.fundedSponsorshipsCount -= 1
    network.save()
}

export function handleFlagged(event: Flagged): void {
    const sponsorship = event.address.toHexString()
    const target = event.params.target.toHexString()
    const flagger = event.params.flagger.toHexString()
    const targetStakeAtRiskWei = event.params.targetStakeAtRiskWei
    const reviewerCount = event.params.reviewerCount.toI32()
    const flagMetadata = event.params.flagMetadata
    const now = event.block.timestamp.toI32()
    log.info('handleFlagged: sponsorship={} flagger={} target={} targetStakeAtRiskWei={} reviewerCount={} flagMetadata={} now={}',
        [ sponsorship, flagger, target, targetStakeAtRiskWei.toString(), reviewerCount.toString(), flagMetadata, now.toString() ])

    // keep the running flagIndex in the first flag, set it to always point to the latest flag
    // the reason why first flag is a good place is that there is a list of flags per Operator-Sponsorship pair,
    //   however Stake (which would be the natural place since it represents such pair) isn't a good place for the running index
    //   because when a vote concludes with VOTE_KICK (or Operator unstakes for whatever reason) the Stake entity is deleted
    const firstFlag = loadOrCreateFlag(sponsorship, target, 0) // loaded here, created in operator.handleReviewRequest
    const flagIndex = firstFlag.lastFlagIndex + 1
    firstFlag.lastFlagIndex = flagIndex
    firstFlag.save()

    const flag = loadOrCreateFlag(sponsorship, target, flagIndex) // loaded here, created in operator.handleReviewRequest
    flag.flagger = flagger
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
    const sponsorship = event.address.toHexString()
    const target = event.params.target.toHexString()
    const statusCode = event.params.status
    const votesForKick = event.params.votesForKick
    const votesAgainstKick = event.params.votesAgainstKick
    const voter = event.params.voter.toHexString()
    const weight = event.params.voterWeight.abs()
    const votedKick = event.params.voterWeight.gt(BigInt.zero())
    const now = event.block.timestamp.toI32()
    log.info('handleFlagUpdate: sponsorship={} target={} status={}, voter={}, vote={}, weight={}, votesFor={} votesAgainst={}', [
        sponsorship, target, statusCode.toString(), voter, votedKick ? "kick" : "no kick", weight.toString(),
        votesForKick.toString(), votesAgainstKick.toString()
    ])

    const flagIndex = Flag.load(sponsorship + "-" + target + "-0")!.lastFlagIndex
    const flag = Flag.load(sponsorship + "-" + target + "-" + flagIndex.toString())!
    flag.result = flagResultStrings[statusCode]
    if (flag.result == "failed") {
        const targetOperator = loadOrCreateOperator(target)
        targetOperator.protectionEndTimestamp = flag.protectionEndTimestamp
    }
    if (flag.result == "kicked" || flag.result == "failed") {
        flag.flagResolutionTimestamp = now
    }
    flag.votesForKick = votesForKick
    flag.votesAgainstKick = votesAgainstKick
    flag.save()

    if (weight.gt(BigInt.zero())) {
        const vote = new Vote(sponsorship + "-" + target + "-" + flagIndex.toString() + "-" + voter)
        vote.flag = flag.id
        vote.voter = voter
        vote.voterWeight = weight
        vote.votedKick = votedKick
        vote.timestamp = now
        vote.save()
    }
}

export function handleOperatorSlashed(event: OperatorSlashed): void {
    const sponsorshipAddress = event.address.toHexString()
    const operatorAddress = event.params.operator.toHexString()
    const slashingAmount = event.params.amountWei
    log.info('handleOperatorSlashed: sponsorship={} operator={} slashingAmount={}',
        [ sponsorshipAddress, operatorAddress, slashingAmount.toString() ])

    const slashID = sponsorshipAddress + "-" + event.transaction.hash.toHexString()
    const slashingEvent = new SlashingEvent(slashID)
    slashingEvent.sponsorship = sponsorshipAddress
    slashingEvent.operator = operatorAddress
    slashingEvent.date = event.block.timestamp
    slashingEvent.amount = slashingAmount
    slashingEvent.save()

    // update Operator
    const operator = Operator.load(operatorAddress)
    if (operator !== null) {
        operator.slashingsCount = operator.slashingsCount + 1
        operator.save()
    }
}

export function handleSponsorshipReceived(event: SponsorshipReceived): void {
    log.info('handleSponsorshipReceived: sponsor={} amount={}', [event.params.sponsor.toHexString(),
        event.params.amount.toString()
    ])
    const sponsorship = Sponsorship.load(event.address.toHexString())
    sponsorship!.cumulativeSponsoring = sponsorship!.cumulativeSponsoring.plus(event.params.amount)
    sponsorship!.save()

    const sponsoringEvent = new SponsoringEvent(event.address.toHexString() + event.transaction.hash.toHexString())
    sponsoringEvent.sponsorship = event.address.toHexString()
    sponsoringEvent.sponsor = event.params.sponsor.toHexString()
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
