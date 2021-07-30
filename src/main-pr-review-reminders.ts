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

      let thereAreBlockerLabels = false;
      for (const label of pr.labels) {
        if (label.name.toUpperCase().startsWith("DO NOT MERGE") || label.name.toUpperCase().startsWith("WIP")) {
          thereAreBlockerLabels = true;
        }
      }
      if (thereAreBlockerLabels) continue;

      // cleaning up old glados comments.
      // comments are sorted by default
      const comments = await octokit.request(
          "GET " + pr.comments_url + "?per_page=1000"
      );
      if (comments?.data?.length >= 1) {
        const filteredComments = comments.data.filter(
            (c) => c?.user?.login === "GladosBlueWallet" && c?.body?.includes('Wake the fuck up samurai')
        );

        for (const comment of filteredComments) {
          if (comment.created_at > new Date((+new Date()) - 24 * 3600 * 1000).toISOString()) {
            continue;
          }

          console.warn("deleting old reminder comment", comment.id, "from PR", pr.number, 'dated', comment.created_at);

          await octokit.request(
              "DELETE /repos/{owner}/{repo}/issues/comments/{comment_id}",
              {
                repo: "BlueWallet",
                owner: "BlueWallet",
                comment_id: comment.id,
              }
          );
        }
      }
      // end comments cleanup

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
