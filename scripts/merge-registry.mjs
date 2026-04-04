import fs from 'fs';
import path from 'path';

const REGISTRY_PATH = 'registry.json';
const HF_MODELS_PATH = 'models/huggingface-models.json';

async function merge() {
  try {
    console.log('Starting merge process...');

    if (!fs.existsSync(REGISTRY_PATH)) {
      console.error('registry.json not found!');
      return;
    }

    if (!fs.existsSync(HF_MODELS_PATH)) {
      console.error('huggingface-models.json not found!');
      return;
    }

    const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
    const hfData = JSON.parse(fs.readFileSync(HF_MODELS_PATH, 'utf8'));

    console.log(`Current models in registry: ${registry.models?.length || 0}`);
    console.log(`HF models to merge: ${hfData.models?.length || 0}`);

    // Ensure models array exists
    if (!registry.models) registry.models = [];

    // Remove existing huggingface models from registry to prevent duplicates
    registry.models = registry.models.filter(m => m.provider !== 'huggingface');

    // Map HF models to registry format
    const newModels = hfData.models.map(m => {
      // Simple description extraction from HTML readme
      let description = '';
      if (m.readme) {
        // Strip HTML tags and take first 200 chars
        description = m.readme
          .replace(/<[^>]*>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .substring(0, 250);
        if (description.length === 250) description += '...';
      }

      return {
        id: m.id,
        name: m.name,
        description: description || `Hugging Face model by ${m.author}`,
        author: m.author,
        version: "1.0.0",
        downloadUrl: m.sourceUrl,
        itemType: "model",
        provider: "huggingface",
        source: "huggingface",
        sourceUrl: m.sourceUrl,
        category: m.category,
        pipelineTag: m.pipelineTag,
        downloads: m.downloads,
        likes: m.likes,
        readme: m.readme,
        submodels: m.submodels.map(s => ({
          id: s.id,
          name: s.name,
          size: s.size,
          downloadUrl: s.downloadUrl
        }))
      };
    });

    // Add new models
    registry.models.push(...newModels);
    
    // Update lastUpdated
    registry.lastUpdated = new Date().toISOString();

    fs.writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2), 'utf8');
    console.log(`Successfully merged ${newModels.length} HF models. Total models: ${registry.models.length}`);

  } catch (error) {
    console.error('Merge failed:', error);
  }
}

merge();
