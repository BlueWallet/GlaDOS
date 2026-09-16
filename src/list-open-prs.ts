export async function listAllOpenPullRequests(octokit) {
  const pullRequests = [];
  const per_page = 100;
  let page = 1;

  while (true) {
    const { data } = await octokit.pulls.list({
      repo: "BlueWallet",
      owner: "BlueWallet",
      state: "open",
      per_page,
      page,
    });
    pullRequests.push(...data);
    if (data.length < per_page) break;
    page += 1;
  }

  return pullRequests;
}
