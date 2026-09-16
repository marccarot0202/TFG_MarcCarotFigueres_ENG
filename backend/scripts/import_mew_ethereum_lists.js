const { initDB, addKnownAddress, closeDB } = require('../services/database');

const DARKLIST_URL =
  'https://raw.githubusercontent.com/MyEtherWallet/ethereum-lists/master/src/addresses/addresses-darklist.json';

const LIGHTLIST_URL =
  'https://raw.githubusercontent.com/MyEtherWallet/ethereum-lists/master/src/addresses/addresses-lightlist.json';

function normalizeAddress(address) {
  if (!address || typeof address !== 'string') {
    return null;
  }

  return address.trim().toLowerCase();
}

async function fetchJson(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Could not download ${url} (${response.status})`);
  }

  return await response.json();
}

function mapDarklistEntry(entry) {
  const address = normalizeAddress(entry.address);

  if (!address) {
    return null;
  }

  return {
    address,
    label: entry.comment
      ? `Darklist from MEW: ${entry.comment}`.slice(0, 255)
      : 'Address from the MEW darklist',
    type: 'warning',
    source: 'mew_ethereum_lists_darklist',
  };
}

function mapLightlistEntry(entry) {
  const address = normalizeAddress(entry.address);

  if (!address) {
    return null;
  }

  return {
    address,
    label: entry.comment
      ? `MEW lightlist: ${entry.comment}`.slice(0, 255)
      : 'Address from the MEW lightlist',
    type: 'trusted',
    source: 'mew_ethereum_lists_lightlist',
  };
}

async function importEntries(entries, mapper) {
  let imported = 0;
  let skipped = 0;

  for (const entry of entries) {
    const mapped = mapper(entry);

    if (!mapped) {
      skipped += 1;
      continue;
    }

    await addKnownAddress(
      mapped.address,
      mapped.label,
      mapped.type,
      mapped.source,
    );

    imported += 1;
  }

  return { imported, skipped };
}

async function main() {
  await initDB();

  console.log('🌐 Downloading the MEW darklist...');
  const darklist = await fetchJson(DARKLIST_URL);

  console.log('\u{1F310} Downloading the MEW lightlist...');
  const lightlist = await fetchJson(LIGHTLIST_URL);

  console.log(
    `📦 Darklist downloaded: ${
      Array.isArray(darklist) ? darklist.length : 0
    } entries`,
  );
  console.log(
    `\u{1F4E6} Lightlist downloaded: ${
      Array.isArray(lightlist) ? lightlist.length : 0
    } entries`,
  );

  const darkResult = await importEntries(
    Array.isArray(darklist) ? darklist : [],
    mapDarklistEntry,
  );

  const lightResult = await importEntries(
    Array.isArray(lightlist) ? lightlist : [],
    mapLightlistEntry,
  );

  console.log('✅ Import completed');
  console.log(
    `   Darklist -> imported: ${darkResult.imported}, skipped: ${darkResult.skipped}`,
  );
  console.log(
    `   Lightlist -> imported: ${lightResult.imported}, skipped: ${lightResult.skipped}`,
  );
}

main()
  .catch(async (error) => {
    console.error('❌ Error importing ethereum-lists:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await closeDB();
    } catch (_) {}
  });
