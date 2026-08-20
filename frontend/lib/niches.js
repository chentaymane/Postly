// Starter presets, so a new account is not staring at six empty boxes.
//
// Postly's prompts used to name colouring books and a five-year-old with curly
// hair directly in the source. That made every user's posts drift toward one
// shop's world no matter what they sold. The specifics belong to the user now;
// these presets only fill the form in for them, and every field stays editable.
//
// `custom_prompt` is the part that carries the craft of a niche — the rules a
// good writer for that trade would already know.

export const NICHES = {
  custom: {
    label: 'Something else',
    blurb: 'Start blank and describe your own business.',
    fields: {},
  },

  printables: {
    label: 'Printables & digital downloads',
    blurb: 'Colouring books, planners, worksheets, templates.',
    fields: {
      products: 'printable digital downloads — instant-download PDFs customers print at home',
      audience: 'parents, teachers, homeschoolers and hobbyists who want an activity ready in minutes',
      benefits:
        'instant download with nothing to ship; print as many copies as you like; ' +
        'screen-free; costs a fraction of a physical version',
      default_tone: 'warm and cozy',
      custom_prompt:
        'Lead with the moment the download gets used, not the file itself — the quiet twenty minutes ' +
        'it buys, the rainy afternoon it rescues. Say "instant download" and "print at home as many ' +
        'times as you want" plainly, because those are the two things buyers check for. ' +
        'Never imply anything is shipped physically.',
    },
  },

  ecommerce: {
    label: 'Physical products / online shop',
    blurb: 'Handmade, homeware, apparel, anything you ship.',
    fields: {
      products: 'handmade physical products shipped to customers',
      audience: 'shoppers looking for something better made than the high-street version',
      benefits: 'made in small batches, built to last, and worth the wait',
      default_tone: 'friendly and engaging',
      custom_prompt:
        'Show the product in a real home, in use, never floating on a white background. ' +
        'Mention material and craft honestly. Do not invent delivery times, stock numbers or discounts.',
    },
  },

  services: {
    label: 'Services & freelancing',
    blurb: 'Coaching, consulting, design, agency work.',
    fields: {
      products: 'professional services delivered one-to-one or to small teams',
      audience: 'business owners who know their problem but not the fix',
      benefits: 'a specific outcome, delivered by someone who has done it before',
      default_tone: 'professional',
      custom_prompt:
        'Sell the outcome and the proof, never the hours. Open with the exact problem the client ' +
        'is living with. Talk about results in concrete terms; do not invent client names, ' +
        'figures or testimonials.',
    },
  },

  saas: {
    label: 'App or software',
    blurb: 'SaaS, mobile apps, tools.',
    fields: {
      products: 'a software product people use to get a job done faster',
      audience: 'people currently doing this job by hand, or with a tool they dislike',
      benefits: 'saves real time, removes a manual step, works on the first try',
      default_tone: 'bold and energetic',
      custom_prompt:
        'Show the before and after of one workflow. One feature per post, never a feature list. ' +
        'No jargon a new user would not already know. Never invent pricing, uptime or user counts.',
    },
  },

  food: {
    label: 'Food, café or restaurant',
    blurb: 'Bakery, café, catering, food brand.',
    fields: {
      products: 'food made fresh and served or delivered locally',
      audience: 'local people deciding where to eat today',
      benefits: 'made fresh, tastes like someone cared, worth the trip',
      default_tone: 'warm and cozy',
      custom_prompt:
        'Write about taste and texture, in the words someone would use with their mouth full. ' +
        'Name the dish. Mention the time of day it suits. Always include the neighbourhood or city ' +
        'so local people know it is for them. Never invent opening hours or prices.',
    },
  },

  creator: {
    label: 'Creator or personal brand',
    blurb: 'Newsletter, channel, portfolio, coaching.',
    fields: {
      products: 'things I make and share — writing, videos and ideas',
      audience: 'people working on the same thing I am',
      benefits: 'one honest idea at a time, from someone actually doing the work',
      default_tone: 'playful',
      custom_prompt:
        'Write in first person. Tell one small true story per post rather than giving advice from ' +
        'above. Being specific beats being polished. Never fabricate personal anecdotes or numbers.',
    },
  },

  local: {
    label: 'Local business',
    blurb: 'Salon, gym, clinic, studio, trades.',
    fields: {
      products: 'services people book in person, nearby',
      audience: 'people within a short drive who need this soon',
      benefits: 'close by, easy to book, and done properly',
      default_tone: 'friendly and engaging',
      custom_prompt:
        'Always name the area you serve — a local post that could be anywhere reaches no one. ' +
        'Write for someone deciding this week. Never invent availability, prices or offers.',
    },
  },
};

export const NICHE_IDS = Object.keys(NICHES);

export function nicheDefaults(id) {
  return NICHES[id]?.fields || {};
}

// Safe to show in the browser: labels only, no prompt text.
export function nicheCatalogue() {
  return NICHE_IDS.map((id) => ({
    id,
    label: NICHES[id].label,
    blurb: NICHES[id].blurb,
  }));
}
