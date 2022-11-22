import { log } from '@graphprotocol/graph-ts'
import { Project, ProjectPurchase } from '../generated/schema'
import { ProjectPurchased } from '../generated/MarketplaceV4/MarketplaceV4'

export function handleProjectPurchase(event: ProjectPurchased): void {
    const projectId = event.params.productId.toHexString()
    const subscriber = event.params.subscriber.toHexString()
    const subscriptionSeconds = event.params.subscriptionSeconds.toString()
    const price = event.params.price.toString()
    const fee = event.params.fee.toString()
    log.info('handleProjectPurchase: projectId={} subscriber={} subscriptionSeconds={} price={} fee={} blockNumber={}',
        [projectId, subscriber, subscriptionSeconds, price, fee, event.block.number.toString()])

    let project = Project.load(projectId)
    if (project != null) {
        let projectPurchaseId = projectId + '-' + subscriber
        let projectPurchase = new ProjectPurchase(projectPurchaseId)
        projectPurchase.project = projectId
        projectPurchase.subscriber = event.params.subscriber
        projectPurchase.subscriptionSeconds = event.params.subscriptionSeconds
        projectPurchase.price = event.params.price
        projectPurchase.fee = event.params.fee
        projectPurchase.purchasedAt = event.block.timestamp
        projectPurchase.save()
        project.save()
    }
}
