// Voice Profile archetype templates — cold-start scaffolding.
//
// A new user staring at 10 empty profile fields is friction. Most users
// fit roughly into one of a handful of operator archetypes. Each
// archetype here is a fully-populated starter profile they can branch
// from in two clicks: pick one, then edit anything that doesn't fit.
//
// Why archetype templates and not a generic blank: a populated profile
// produces better generations *immediately* than a blank one waiting to
// be filled perfectly. The user gets value on day one, then sharpens
// over weeks as they edit. This is the essential SaaS-vs-bespoke move:
// ship a defensible default, let the customer customize.
//
// To add a new archetype: append to ARCHETYPES with a unique id. The
// id never gets persisted to the user's row — these are templates,
// not selections. Once applied, the user's profile is just a profile.

const ARCHETYPES = [
  {
    id: 'operator-executive',
    label: 'Operator-class executive',
    icon: '🛠',
    description: 'Founder / C-suite at a building-stage company. Speaks from inside the machine, not from commentary. Audience trusts because of evidence of execution.',
    starter: {
      core_thesis:
        'Markets reward legibility, not just performance. Authority compounds when execution is visible, defensible, and named — not when it is louder.',
      stand_for: [
        'Building durable systems before chasing short-cycle attention',
        'First-person scope over abstract assertion — say what you saw, what you tried, what broke',
        'Naming the framework you used so your audience can carry it',
      ],
      stand_against: [
        'Generic motivational tone disguised as strategy',
        'Hype cycles disconnected from operational reality',
        'Hiding hard tradeoffs behind polished case-study language',
      ],
      domains_of_authority: [
        { domain: 'Operating discipline under constraint', why: 'have run real teams through real cycles, not just commented on them' },
        { domain: 'Translating execution into commercial leverage', why: 'have been responsible for revenue tied to the systems described' },
      ],
      frameworks: [
        { name: 'Distribution Debt', description: 'The unrealized commercial value of work you have done but not made legible to your market' },
        { name: 'Operational Aesthetics', description: 'The cultural signaling effect of how a company runs internally — visible to careful observers' },
      ],
      voice_laws: [
        'Write in prose, not bullet points',
        'Name the framework before explaining it',
        'No hedging — take a position even when uncomfortable',
        'First-person scope when making evidentiary claims',
      ],
      primary_audiences: [
        { audience: 'Founders building serious companies', what_they_need: 'sharper thinking on what to build versus what to ship' },
        { audience: 'Executives responsible for team performance', what_they_need: 'frameworks they can apply Monday morning' },
      ],
      anti_voice: [
        'Polished consultant deck-speak',
        'Creator-economy "10 lessons I learned" listicle voice',
        'Performative humility ("just sharing my thoughts…")',
      ],
      strategic_horizon:
        'Build a body of work that signals operational depth across a 6–12 month arc, so the next funding / hiring / partnership conversation already has context in the room.',
      regional_context: '',
    },
  },
  {
    id: 'creator-economy-founder',
    label: 'Creator-economy founder',
    icon: '🎙',
    description: 'Built a media presence first, then a company. Voice is conversational and candid; audience expects behind-the-scenes texture from an active builder.',
    starter: {
      core_thesis:
        'Audience and product are one feedback loop. The creators who win build the product alongside their audience instead of ahead of it.',
      stand_for: [
        'Public building over private polish',
        'Treating audience as collaborators, not consumers',
        'Documenting the path more than the outcome',
      ],
      stand_against: [
        'Manufactured authenticity — the rehearsed-vulnerable post',
        'Influencer playbook applied to substantive work',
        'Engagement-bait formats that erode trust',
      ],
      domains_of_authority: [
        { domain: 'Building in public at scale', why: 'have grown a real audience while shipping a real product, not after' },
        { domain: 'Creator-to-product transition', why: 'have lived the operational shift from one-person studio to team' },
      ],
      frameworks: [
        { name: 'Audience-As-Compound-Asset', description: 'Each piece of content has a long-term portfolio value, not just first-week reach' },
      ],
      voice_laws: [
        'Specific over abstract — name the tool, the number, the screenshot',
        'Conversational register — write like you talk to your smartest friend',
        'No "thread 1/N" formats — write what you mean to write',
      ],
      primary_audiences: [
        { audience: 'Creators evolving into operators', what_they_need: 'permission and patterns for the operational layer they have to grow into' },
        { audience: 'Early-stage founders weighing the audience-first path', what_they_need: 'honest math on the tradeoffs' },
      ],
      anti_voice: [
        'Influencer-speak ("guys, you won\'t believe…")',
        'Engagement-farming reply-guy energy',
      ],
      strategic_horizon:
        'Convert audience attention into a product flywheel where the next launch already has its first hundred users in the room.',
      regional_context: '',
    },
  },
  {
    id: 'public-intellectual',
    label: 'Public intellectual / domain expert',
    icon: '🏛',
    description: 'Practitioner whose authority comes from depth in a specific field. Writes to shape how the field is understood, not to broadcast personal updates.',
    starter: {
      core_thesis:
        'Public discourse in this field is downstream of the people who do the work. When practitioners are visible and clear, the field gets sharper.',
      stand_for: [
        'Defending the difficulty of the work against simplifying narratives',
        'Naming the actual constraints the field operates under',
        'Crediting prior thinking honestly',
      ],
      stand_against: [
        'Hot-take culture that flattens nuanced work',
        'Self-styled experts who never shipped',
        'Borrowed authority — citing without engaging',
      ],
      domains_of_authority: [
        { domain: '[Your specific field]', why: 'years of direct work, not synthesis from afar' },
      ],
      frameworks: [
        { name: '[Your signature mental model]', description: 'How you think about the central problem in your field' },
      ],
      voice_laws: [
        'Write as if your peers are reading',
        'Concede the strongest version of opposing views before disagreeing',
        'Cite specifics; abstract claims are weak claims',
        'Let complexity stand — do not flatten what is genuinely hard',
      ],
      primary_audiences: [
        { audience: 'Other serious practitioners in your field', what_they_need: 'sharper articulations of problems they are also working on' },
        { audience: 'Decision-makers funding or governing the field', what_they_need: 'honest framings that survive contact with reality' },
      ],
      anti_voice: [
        'Pundit register — confident takes thinly grounded',
        'Pop-explainer voice that flattens for engagement',
      ],
      strategic_horizon:
        'Become the writer practitioners in this field share when explaining the field to outsiders, because the framings are the most defensible available.',
      regional_context: '',
    },
  },
  {
    id: 'haitian-caribbean-operator',
    label: 'Haitian / Caribbean market operator',
    icon: '🌍',
    description: 'Building under specific regional gravity. Voice carries local context that institutional brands cannot hold credibly.',
    starter: {
      core_thesis:
        'Building under fragile conditions is a truth-revealing environment. Systems that survive here are systems worth exporting elsewhere.',
      stand_for: [
        'Local capacity before imported playbooks',
        'Naming the specific constraint, not the generic one',
        'Building durable institutions in environments that punish shortcuts',
      ],
      stand_against: [
        'Diaspora-romantic posts disconnected from on-the-ground operations',
        'Solutionist NGO voice that treats the region as a problem to be solved',
        'Generic Africa/Caribbean lumping that erases specific markets',
      ],
      domains_of_authority: [
        { domain: 'Operating in low-trust, high-volatility markets', why: 'lived experience, not consulting tour' },
        { domain: 'Regional commercial reality', why: 'have built or sold in specific markets people generalize about' },
      ],
      frameworks: [
        { name: 'Constraint as X-Ray', description: 'Hard environments expose which systems actually work — fragile ones get protected by abundance' },
      ],
      voice_laws: [
        'Specific country / specific market — never "the region" without grounding',
        'Bilingual when the voice serves it; native register, not academic',
        'Cite local examples first, global comparisons second',
      ],
      primary_audiences: [
        { audience: 'Operators building seriously in the region', what_they_need: 'honest framings that match what they live' },
        { audience: 'International investors / partners considering the region', what_they_need: 'realistic context to replace stale narratives' },
      ],
      anti_voice: [
        'Diaspora optimism without operational base',
        'Pity register / development-speak',
      ],
      strategic_horizon:
        'Become the writer institutional partners read when they want to understand the region from someone who is actually building in it.',
      regional_context: 'Specify your country and the market sub-context you operate in. Replace "[your region]" placeholders with concrete geography.',
    },
  },
];

const ARCHETYPE_BY_ID = Object.fromEntries(ARCHETYPES.map((a) => [a.id, a]));

function listArchetypes() {
  return ARCHETYPES.map((a) => ({
    id: a.id,
    label: a.label,
    icon: a.icon,
    description: a.description,
  }));
}

function getArchetype(id) {
  return ARCHETYPE_BY_ID[id] || null;
}

module.exports = { ARCHETYPES, listArchetypes, getArchetype };
