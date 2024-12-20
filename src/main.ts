import * as github from "@actions/github";
const querystring = require('querystring');
const https = require('https');

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


  const { data: _repoCollaborators } = await octokit.repos.listCollaborators({
    repo: "BlueWallet",
    owner: "BlueWallet",
  });
  const repoCollaborators= _repoCollaborators.map(c => c.login);


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
    let integrationTestsPassed = false;
    let lintTestsPassed = false;
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
      if (check.name === "e2e" && check.conclusion === "success") e2ePassed = true;
      if (check.name === "test" && check.conclusion === "success") {
        // in job "test" we run all of it, so if it passes - all of them passed
        unitTestsPassed = true;
        integrationTestsPassed = true;
        lintTestsPassed = true;
      }
    }

    if (reviews.data.length >= 1) {
      let _approves = {};
      for (const review of reviews.data) {
        if (review.user.login === pr.user.login) {
          // comments by the PR author do not count
          continue;
        }

        if (!repoCollaborators.includes(review.user.login)) {
          // reviews by outside contributors do not count
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

      if (Object.keys(_approves).length === 0) {
        // no human approves were given, only maybe bot comments
        approved = false;
      }
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
      if (status.context.startsWith("ci/circleci: unit") && status.state === "success") unitTestsPassed = true;
      if (status.context.startsWith("ci/circleci: integration") && status.state === "success") integrationTestsPassed = true;
      if (status.context.startsWith("ci/circleci: lint") && status.state === "success") lintTestsPassed = true;
    }

    console.log({
      approved,
      e2ePassed,
      unitTestsPassed,
      integrationTestsPassed,
      lintTestsPassed,
      outsiderContributor,
      thereAreBlockerLabels,
    });

    if (
      approved &&
      e2ePassed &&
      unitTestsPassed &&
      integrationTestsPassed &&
      lintTestsPassed &&
      !outsiderContributor &&
      !thereAreBlockerLabels
    ) {
      console.log("LGTM. lets merge");
      postDataToTrafficRobot('GlaDOS: Im going to merge ' + 'https://github.com/BlueWallet/BlueWallet/pull/' + pr.number + " (" + pr.title + ")", process.env.CONNECTOR_ID);
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

function postDataToTrafficRobot(data, connectorId) {
  console.log('notifying trafficRobot');
  var postData = querystring.stringify({
    data
  });

  var options = {
    hostname: 'push.tg',
    port: 443,
    path: '/' + connectorId,
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': postData.length
    }
  };

  var req = https.request(options, (res) => {
    res.on("data", (d) => {
      console.log(d);
    });
  });

  req.on('error', (e) => {
    console.error(e);
  });

  req.write(postData);
  req.end();
}

run();
