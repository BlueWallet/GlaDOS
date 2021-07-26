import * as core from "@actions/core";
import * as github from "@actions/github";

const token = process.env.TOKEN;
if (!token) {
  console.error("no TOKEN env provided");
  process.exit(1);
}

async function run(): Promise<void> {
  const octokit = github.getOctokit(token);

  try {
    const { data: pullRequests } = await octokit.pulls.list({
      repo: "BlueWallet",
      owner: "BlueWallet",
      state: "open",
    });

    for (const pr of pullRequests) {
      console.log(`${pr.title} (${pr.number})`);

      const _requestedReviewers = {};

      const requestedReviews = await octokit.request("GET /repos/{owner}/{repo}/pulls/{ref}/requested_reviewers", {
        repo: "BlueWallet",
        owner: "BlueWallet",
        ref: pr.number,
      });

      for (const reviewer of requestedReviews?.data?.users || []) {
        _requestedReviewers[reviewer.login] = true;
      }

      console.warn('requested reviewers:', _requestedReviewers);

      for (const user of requestedReviews?.data?.users) {
        const reviewer = user.login;
        console.log(reviewer, 'SHOULD BE NOTIFIED');
        const body = "Wake the fuck up samurai, we have PRs to merge\n\n" +
            "![image](https://user-images.githubusercontent.com/1913337/127044132-147fa451-6dc1-454f-907a-9292033047f2.png)\n\n" +
            `[all PRs for @${reviewer}] https://github.com/BlueWallet/BlueWallet/pulls/review-requested/${reviewer}`

        await octokit.issues.createComment({
          repo: "BlueWallet",
          owner: "BlueWallet",
          issue_number: pr.number,
          body,
        });
      }

      console.log("=======================================================\n");
    }
  } catch (error) {
    console.warn(error);
  }
}

run();
