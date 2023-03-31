const {
    flagReviewerCount = "",
    PEER_COUNT = "",
    flagReviewerSelectionIterations = ""
} = process.env

const reviewerCount = +flagReviewerCount || 5
const peerCount = +PEER_COUNT || 7
const iterations = +flagReviewerSelectionIterations || 20

// probability that i reviewers have been picked
let reviewersProbability = Array(reviewerCount + 1).fill(0)
reviewersProbability[0] = 1

const successProbability = []
const mostLikely = []
const mostLikelyProbability = []

for (let i = 0; i < iterations; i++) {
    const probabilityAfter = Array(reviewerCount + 1).fill(0)
    probabilityAfter[reviewerCount] = reviewersProbability[reviewerCount] // if we're done, we won't be undone
    for (let j = 0; j < reviewerCount; j++) {
        // NOT picking a new reviewer means hitting amount all peers a picked reviewer OR flagger/target (+2)
        const pNotPick = (j + 2) / peerCount
        probabilityAfter[j] += reviewersProbability[j] * pNotPick // we stay at j
        probabilityAfter[j + 1] += reviewersProbability[j] * (1 - pNotPick) // we move on to j + 1
    }
    reviewersProbability = probabilityAfter

    successProbability[i] = reviewersProbability[reviewerCount]
    mostLikelyProbability[i] = Math.max(...reviewersProbability)
    mostLikely[i] = reviewersProbability.indexOf(mostLikelyProbability[i])
}

console.log("Probability of success after i iterations: ", successProbability.map((p) => +p.toString().slice(0, 6)))
console.log("Most likely number of reviewers after i iterations: ", mostLikely)
console.log("Probability of most likely number of reviewers after i iterations: ", mostLikelyProbability)

console.log("Success becomes > 50% after", successProbability.findIndex((p) => p > 0.5))
console.log("Success becomes > 95% after", successProbability.findIndex((p) => p > 0.95))
console.log("Success becomes > 99% after", successProbability.findIndex((p) => p > 0.99))
console.log("Success becomes > 1 - 1 / 1 000 000 after", successProbability.findIndex((p) => p > 1 - 1e-6))