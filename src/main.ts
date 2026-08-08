import * as github from "@actions/github";
const querystring = require('querystring');
const https = require('https');

const token = process.env.TOKEN;
if (!token) {
  console.error("no TOKEN env provided");
  process.exit(1);
}

// Stacked PRs require the async merge API + polling (sync pulls.merge rejects them).
async function mergePullRequestAsync(octokit, pullNumber, mergeMethod?) {
  const params: any = {
    owner: "BlueWallet",
    repo: "BlueWallet",
    pull_number: pullNumber,
  };
  if (mergeMethod) params.merge_method = mergeMethod;

  let { data } = await octokit.request(
    "PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge-async",
    params
  );

  for (let i = 0; data.status === "pending" && data.details?.uuid && i < 180; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    ({ data } = await octokit.request(
      "GET /repos/{owner}/{repo}/pulls/{pull_number}/merge-async/{uuid}",
      {
        owner: "BlueWallet",
        repo: "BlueWallet",
        pull_number: pullNumber,
        uuid: data.details.uuid,
      }
    ));
  }

  if (data.status === "pending") {
    throw new Error(`async merge still pending for PR #${pullNumber}`);
  }

  return { status: data.status, message: data.details?.message || data.status };
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

//    if (pr.number !== 8532) continue; //debug

    if (pr.draft) {
      console.log(`draft PR, skipping`);
      continue;
    }

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
    let e2eAndroidPassed = false;
    let e2eIosPassed = false;
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

    const { data: workflowRuns } = await octokit.actions.listWorkflowRunsForRepo({
      repo: "BlueWallet",
      owner: "BlueWallet",
      head_sha: pr.head.sha,
    });
    const suiteToWorkflow = new Map(
      workflowRuns.workflow_runs
        .filter((run) => run.check_suite_id != null)
        .map((run) => [run.check_suite_id!, run.name])
    );

    for (const check of checks.data.check_runs) {
      const suiteId = check.check_suite?.id;
      const workflowName = suiteId != null ? suiteToWorkflow.get(suiteId) : undefined;

      if (check.conclusion === "success" && check.name === "test") {
        if (workflowName?.includes("iOS")) e2eIosPassed = true;
        if (workflowName?.includes("Android")) e2eAndroidPassed = true;
      }
      if (check.name === "unit" && check.conclusion === "success") unitTestsPassed = true;
      if (check.name === "lint" && check.conclusion === "success") lintTestsPassed = true;
      if (check.name === "integration" && check.conclusion === "success") integrationTestsPassed = true;
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

        if (review.user.login === 'GladosBlueWallet') {
          // our own bot doesnt count
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
      e2eAndroidPassed,
      e2eIosPassed,
      unitTestsPassed,
      integrationTestsPassed,
      lintTestsPassed,
      outsiderContributor,
      thereAreBlockerLabels,
    });

    if (
      approved &&
      e2eAndroidPassed &&
      e2eIosPassed &&
      unitTestsPassed &&
      integrationTestsPassed &&
      lintTestsPassed &&
      !outsiderContributor &&
      !thereAreBlockerLabels
    ) {
      console.log("LGTM. lets merge");
      // continue; // fixme

      try {
        const { data: prFull } = await octokit.pulls.get({
          repo: "BlueWallet",
          owner: "BlueWallet",
          pull_number: pr.number,
        });

        let mergeResult;
        if (prFull.commits >= 3) {
          console.log(`PR has ${prFull.commits} commits (>=3), trying squash`);
          try {
            mergeResult = await mergePullRequestAsync(octokit, pr.number, "squash");
            if (mergeResult.status === "failed") throw new Error(mergeResult.message);
          } catch (squashError) {
            console.warn("squash failed, falling back to regular merge:", squashError.message);
            mergeResult = await mergePullRequestAsync(octokit, pr.number);
          }
        } else {
          mergeResult = await mergePullRequestAsync(octokit, pr.number);
        }

        let body = "I could not merge it.";
        if (mergeResult.status === "merged" || mergeResult.status === "enqueued") {
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
