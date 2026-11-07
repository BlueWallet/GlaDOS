type Review = { user: { login: string }; state: string };

// Bot approval does not count as a human approval.
// A request for changes from the bot blocks the merge until the bot approves.
export function reviewsAllowMerge(
  reviews: Review[],
  prAuthor: string,
  collaborators: string[]
): boolean {
  if (reviews.length < 1) return false;

  const approves: Record<string, boolean> = {};
  for (const review of reviews) {
    const login = review.user.login;
    if (login === prAuthor) continue;
    if (!collaborators.includes(login)) continue;

    if (login === "GladosBlueWallet") {
      if (review.state === "CHANGES_REQUESTED") {
        console.log("NOT approved by", login);
        approves[login] = false;
      } else if (review.state === "APPROVED") {
        delete approves[login];
      }
      continue;
    }

    if (review.state !== "APPROVED") {
      console.log("NOT approved by", login);
      approves[login] = false;
    } else {
      console.log("approved by", login);
      approves[login] = true;
    }
  }

  let approved =
    Object.values(approves).filter((el) => el === false).length === 0;

  if (Object.keys(approves).length === 0) {
    approved = false;
  }

  return approved;
}
