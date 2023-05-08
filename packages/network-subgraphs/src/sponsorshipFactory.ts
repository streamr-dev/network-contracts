import { BigInt, log } from '@graphprotocol/graph-ts'

import { NewSponsorship } from '../generated/SponsorshipFactory/SponsorshipFactory'
import { Sponsorship, Stream } from '../generated/schema'
import { Sponsorship as SponsorshipTemplate } from '../generated/templates'
import { updateOrCreateSponsorshipDailyBucket } from './helpers'

export function handleNewSponsorship(event: NewSponsorship): void {
    log.info('handleNewSponsorship at {}', [event.params.sponsorshipContract.toHexString()])

    let sponsorship = new Sponsorship(event.params.sponsorshipContract.toHexString())
    sponsorship.totalStakedWei = BigInt.fromI32(0)
    sponsorship.unallocatedWei = BigInt.fromI32(0)
    sponsorship.projectedInsolvency = BigInt.fromI32(0)
    sponsorship.operatorCount = 0
    sponsorship.isRunning = false
    sponsorship.metadata = event.params.metadata
    sponsorship.totalPayoutWeiPerSec = event.params.totalPayoutWeiPerSec
    sponsorship.save()

    // try to load stream entity
    let stream = Stream.load(event.params.streamId.toString())
    if (stream != null) {
        sponsorship.stream = stream.id
        sponsorship.save()
    }

    // Instantiate template
    SponsorshipTemplate.create(event.params.sponsorshipContract)
    // SponsorshipTemplate.create(event.params.sponsorshipContract)
    updateOrCreateSponsorshipDailyBucket(event.params.sponsorshipContract.toHexString(),
        event.block.timestamp,
        BigInt.fromI32(0),
        BigInt.fromI32(0),
        0,
        null)
}
