// Server-only maintenance; never import this module into the Expo app.
export async function cleanupAvatars(client, batchSize = 100) {
  const { data: jobs, error } = await client.rpc('claim_avatar_cleanup', { batch_size: batchSize });
  if (error) throw new Error('Could not claim avatar cleanup jobs.');
  let removed = 0;
  for (const job of jobs) {
    const deleted = await client.storage.from('profile-avatars').remove([job.storage_path]);
    if (deleted.error) continue;
    const finished = await client.rpc('finish_avatar_cleanup', { object_path: job.storage_path });
    if (!finished.error) removed++;
  }
  return { claimed: jobs.length, removed, retry: jobs.length - removed };
}
