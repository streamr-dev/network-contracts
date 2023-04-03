import { log } from '@graphprotocol/graph-ts'
import { ProjectPurchase } from '../generated/schema'
import { ProjectPurchased } from '../generated/MarketplaceV4/MarketplaceV4'
import { loadOrCreateProject } from './helpers'

export function handleProjectPurchase(event: ProjectPurchased): void {
    const projectId = event.params.projectId.toHexString()
    const subscriber = event.params.subscriber.toHexString()
    const subscriptionSeconds = event.params.subscriptionSeconds.toString()
    const price = event.params.price.toString()
    const fee = event.params.fee.toString()
    log.info('handleProjectPurchase: projectId={} subscriber={} subscriptionSeconds={} price={} fee={} blockNumber={}',
        [projectId, subscriber, subscriptionSeconds, price, fee, event.block.number.toString()])

    let project = loadOrCreateProject(event.params.projectId)

    const newCounter = project.counter + 1
    const projectPurchaseId = projectId + '-' + subscriber + '-' + newCounter.toString()
    log.info('handleProjectPurchase: projectPurchaseId={}', [projectPurchaseId])

    const projectPurchase = new ProjectPurchase(projectPurchaseId)
    projectPurchase.project = projectId
    projectPurchase.subscriber = event.params.subscriber
    projectPurchase.subscriptionSeconds = event.params.subscriptionSeconds
    projectPurchase.price = event.params.price
    projectPurchase.fee = event.params.fee
    projectPurchase.purchasedAt = event.block.timestamp
    project.counter = newCounter

    let i = project.purchases.indexOf(projectPurchaseId)
    if (i < 0) {
        let purchasesArray = project.purchases
        purchasesArray.push(projectPurchaseId)
        project.purchases = purchasesArray
    }

    project.save()
    projectPurchase.save()
}
