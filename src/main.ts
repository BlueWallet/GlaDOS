import * as github from "@actions/github";

const token = process.env.TOKEN;
if (!token) {
  console.error("no TOKEN env provided");
  process.exit(1);
}

async function run(): Promise<void> {
  const octokit = github.getOctokit(token);

  const { data: pullRequests } = await octokit.pulls.list({
    repo: "BlueWallet",
    owner: "BlueWallet",
    state: "open",
  });

  for (const pr of pullRequests) {
    console.log(`${pr.title} (${pr.number}), author: ${pr.user.login}`);

    // cleaning up old glados comments.
    // comments are sorted by default
    const comments = await octokit.request(
      "GET " + pr.comments_url + "?per_page=1000"
    );
    if (comments?.data?.length >= 1) {
      const filteredComments = comments.data.filter(
        (c) =>
          c?.user?.login === "GladosBlueWallet" &&
          c?.body?.includes("HUGE SUCCESS")
      );
      const deleteMax = filteredComments.length - 1;
      let deleted = 0;
      for (const comment of filteredComments) {
        if (deleted++ >= deleteMax) break;
        console.warn("deleting comment", comment.id, "from PR", pr.number);

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

    let approved = false;
    let e2ePassed = false;
    let unitTestsPassed = false;
    let thereAreBlockerLabels = false;
    let outsiderContributor =
      pr.head.repo.full_name !== "BlueWallet/BlueWallet";

    for (const label of pr.labels) {
      if (
        label.name.toUpperCase().startsWith("DO NOT MERGE") ||
        label.name.toUpperCase().startsWith("WIP")
      ) {
        thereAreBlockerLabels = true;
      }
    }

    const reviews = await octokit.request(
      "GET /repos/{owner}/{repo}/pulls/{ref}/reviews",
      {
        repo: "BlueWallet",
        owner: "BlueWallet",
        ref: pr.number,
      }
    );

    const checks = await octokit.checks.listForRef({
      repo: "BlueWallet",
      owner: "BlueWallet",
      ref: pr.head.sha,
    });

    for (const check of checks.data.check_runs) {
      if (check.name.startsWith("Travis CI") && check.conclusion === "success")
        e2ePassed = true;
      if (check.name === "e2e" && check.conclusion === "success")
        e2ePassed = true;
      if (check.name === "test" && check.conclusion === "success")
        unitTestsPassed = true;
      // so if Travis or GithubActions passes - it still gets green lights since its the same set of tests
    }

    if (reviews.data.length >= 1) {
      let _approves = {};
      for (const review of reviews.data) {
        if (review.user.login === pr.user.login) {
          // comments by the PR author do not count
          continue;
        }

        // if (review["state"] === "COMMENTED") continue;
        if (review["state"] !== "APPROVED") {
          console.log("NOT approved by", review.user.login);
          _approves[review.user.login] = false;
        } else {
          console.log("approved by", review.user.login);
          _approves[review.user.login] = true;
        }
      }

      approved =
        Object.values(_approves).filter((el) => el === false).length === 0;
    }

    if (pr.requested_reviewers.length !== 0) {
      console.log("not all requested reviews are done");
      approved = false;
    }

    const statuses = await octokit.request(
      "GET /repos/{owner}/{repo}/commits/{ref}/status",
      {
        repo: "BlueWallet",
        owner: "BlueWallet",
        ref: pr.head.sha,
      }
    );

    for (const status of statuses.data.statuses) {
      if (
        status.context.startsWith("ci/circleci") &&
        status.state === "success"
      )
        unitTestsPassed = true;
    }

    console.log({
      approved,
      e2ePassed,
      unitTestsPassed,
      outsiderContributor,
      thereAreBlockerLabels,
    });

    if (
      approved &&
      e2ePassed &&
      unitTestsPassed &&
      !outsiderContributor &&
      !thereAreBlockerLabels
    ) {
      console.log("LGTM. lets merge");
      // continue; // fixme

      try {
        const mergeResult = await octokit.pulls.merge({
          repo: "BlueWallet",
          owner: "BlueWallet",
          pull_number: pr.number,
        });

        let body = "I could not merge it.";
        if (mergeResult.data.message.indexOf("successfully") !== -1) {
          console.log({ mergeResult });
          body =
            "Unbelievable. You, [subject name here], must be the pride of [subject hometown here]!";
        }

        await octokit.issues.createComment({
          repo: "BlueWallet",
          owner: "BlueWallet",
          issue_number: pr.number,
          body,
        });
      } catch (error) {
        console.warn(error.message);
      }
    }

    console.log("=======================================================\n");
  }
}

run();
