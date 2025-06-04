import { BigDecimal, BigInt, log } from '@graphprotocol/graph-ts'

import { Sponsorship as SponsorshipContract } from '../generated/templates/Sponsorship/Sponsorship'
import { NewSponsorship } from '../generated/SponsorshipFactory/SponsorshipFactory'
import { Sponsorship, Stream } from '../generated/schema'
import { Sponsorship as SponsorshipTemplate } from '../generated/templates'
import { loadOrCreateNetwork, loadOrCreateSponsorshipDailyBucket, MAX_STREAM_ID_LENGTH } from './helpers'

export function handleNewSponsorship(event: NewSponsorship): void {
    const sponsorshipContractAddress = event.params.sponsorshipContract
    const sponsorshipContractAddressString = sponsorshipContractAddress.toHexString()
    const creator = event.params.creator.toHexString()
    log.info('handleNewSponsorship: blockNumber={} sponsorshipContract={} policies=[{}] policyParams={} creator={}',
        [event.block.number.toString(), sponsorshipContractAddressString,
            event.params.policies.map<string>((x) => x.toHexString()).join(", "), event.params.policyParams.toString(), creator]
    )
    if (event.params.streamId.length > MAX_STREAM_ID_LENGTH) {
        log.warning("Overlong stream id not supported: {}", [event.params.streamId]) 
        return
    }

    const sponsorship = new Sponsorship(sponsorshipContractAddressString)
    sponsorship.totalStakedWei = BigInt.zero()
    sponsorship.remainingWei = BigInt.zero()
    sponsorship.spotAPY = BigDecimal.zero()
    sponsorship.projectedInsolvency = event.block.timestamp
    sponsorship.operatorCount = 0
    sponsorship.isRunning = false
    sponsorship.metadata = event.params.metadata
    sponsorship.totalPayoutWeiPerSec = event.params.policyParams[0]
    sponsorship.minimumStakingPeriodSeconds = event.params.policyParams[1]
    sponsorship.creator = creator
    sponsorship.cumulativeSponsoring = BigInt.zero()

    // TODO: once it's possible to add minOperatorCount to NewSponsorship event, get rid of this smart contract call
    sponsorship.minOperators = SponsorshipContract.bind(sponsorshipContractAddress).minOperatorCount().toI32()

// The standard ordering is: allocation, leave, kick, join policies
// "Operator-only join policy" is always set, so we check if we have 5 policies,
//   and in that case we assume the 4th policy is the "max-operators join policy"
if (event.params.policies.length == 4) {
    sponsorship.maxOperators = event.params.policyParams[3].toI32()
}
    sponsorship.save()

    // try to load stream entity
    const stream = Stream.load(event.params.streamId.toString())
    if (stream != null) {
        sponsorship.stream = stream.id
        sponsorship.save()
    }

    // start listening to events from the newly created Sponsorship contract
    SponsorshipTemplate.create(event.params.sponsorshipContract)

    const bucket = loadOrCreateSponsorshipDailyBucket(sponsorship, event.block.timestamp)
    bucket.save()

    const network = loadOrCreateNetwork()
    network.sponsorshipsCount = network.sponsorshipsCount + 1
    network.save()
}
