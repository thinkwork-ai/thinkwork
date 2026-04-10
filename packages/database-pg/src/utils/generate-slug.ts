/**
 * Generate a slug in the format `adjective-animal-NNN`.
 * Example: `dapper-capybara-742`
 *
 * Word lists sourced from Convex's curated deployment name generator.
 */

const ADJECTIVES = [
	"abundant", "academic", "accomplished", "accurate", "acoustic", "acrobatic",
	"adamant", "adept", "adjoining", "admired", "adorable", "adventurous",
	"affable", "agile", "agreeable", "amiable", "amicable", "animated",
	"ardent", "aromatic", "artful", "astute", "avid", "aware", "basic",
	"beaming", "befitting", "beloved", "benevolent", "blessed", "blissful",
	"bold", "brainy", "brave", "brazen", "bright", "brilliant", "calculating",
	"calm", "canny", "capable", "careful", "cautious", "ceaseless", "charming",
	"chatty", "cheerful", "cheery", "clean", "clear", "clever", "colorful",
	"colorless", "combative", "compassionate", "confident", "content", "cool",
	"coordinated", "courteous", "curious", "dapper", "dashing", "dazzling",
	"deafening", "decisive", "dependable", "descriptive", "determined",
	"different", "diligent", "disciplined", "doting", "dusty", "dutiful",
	"dynamic", "earnest", "effervescent", "efficient", "elated", "elegant",
	"enchanted", "enduring", "energetic", "energized", "exciting", "expert",
	"exuberant", "fabulous", "famous", "fantastic", "fast", "fastidious",
	"fearless", "festive", "fiery", "fine", "first", "fleet", "flexible",
	"flippant", "focused", "formal", "fortunate", "friendly", "frugal",
	"gallant", "giant", "giddy", "glad", "glorious", "good", "graceful",
	"grand", "grandiose", "grateful", "greedy", "gregarious", "groovy",
	"hallowed", "handsome", "hardy", "harmless", "healthy", "hearty",
	"helpful", "hidden", "hip", "honorable", "hushed", "ideal", "impartial",
	"impressive", "incredible", "industrious", "insightful", "intent", "jovial",
	"joyous", "judicious", "keen", "kindhearted", "kindly", "kindred",
	"knowing", "laudable", "limitless", "little", "lovable", "lovely", "loyal",
	"majestic", "marvelous", "mellow", "merry", "mild", "modest", "moonlit",
	"nautical", "neat", "necessary", "neighborly", "next", "notable", "oceanic",
	"optimistic", "opulent", "original", "outgoing", "outstanding", "pastel",
	"patient", "peaceful", "perceptive", "perfect", "pleasant", "polished",
	"polite", "posh", "precious", "precise", "prestigious", "proficient",
	"proper", "quaint", "qualified", "quick", "quiet", "quirky", "quixotic",
	"rapid", "rare", "reliable", "reminiscent", "resilient", "resolute",
	"rightful", "robust", "rosy", "rugged", "savory", "scintillating",
	"scrupulous", "secret", "sensible", "shiny", "shocking", "silent",
	"sincere", "sleek", "small", "spotted", "standing", "steady", "stoic",
	"striped", "strong", "successful", "superb", "tacit", "tame", "tangible",
	"terrific", "third", "tidy", "tough", "tremendous", "trustworthy",
	"uncommon", "unique", "upbeat", "usable", "useful", "utmost", "valiant",
	"valuable", "veracious", "vibrant", "vivid", "wandering", "warmhearted",
	"wary", "watchful", "whimsical", "wonderful", "wooden", "woozy", "wry",
	"youthful", "zany", "zealous",
];

const ANIMALS = [
	"aardvark", "akita", "albatross", "alligator", "alpaca", "anaconda", "ant",
	"anteater", "antelope", "armadillo", "avocet", "axolotl", "badger",
	"bandicoot", "barracuda", "basilisk", "bass", "bat", "beagle", "bear",
	"bee", "bird", "bison", "blackbird", "bloodhound", "boar", "bobcat",
	"buffalo", "bulldog", "bullfrog", "butterfly", "buzzard", "caiman", "camel",
	"canary", "capybara", "cardinal", "caribou", "cassowary", "cat",
	"caterpillar", "chameleon", "cheetah", "chickadee", "chicken", "chihuahua",
	"chinchilla", "chipmunk", "civet", "clam", "clownfish", "cobra", "cod",
	"condor", "corgi", "cormorant", "cow", "coyote", "crab", "crane",
	"cricket", "crocodile", "crow", "curlew", "cuttlefish", "dachshund",
	"dalmatian", "deer", "dinosaur", "dodo", "dog", "dogfish", "dolphin",
	"donkey", "dotterel", "dove", "dragon", "duck", "eagle", "echidna", "eel",
	"egret", "elephant", "elk", "emu", "ermine", "falcon", "fennec", "ferret",
	"finch", "firefly", "fish", "flamingo", "fly", "fox", "frog", "gazelle",
	"gecko", "gerbil", "giraffe", "gnat", "gnu", "goat", "goldfinch",
	"goldfish", "goose", "gopher", "goshawk", "grasshopper", "greyhound",
	"grouse", "guanaco", "guineapig", "gull", "hamster", "hare", "hawk",
	"hedgehog", "heron", "herring", "hippopotamus", "hornet", "horse", "hound",
	"hummingbird", "husky", "hyena", "ibex", "ibis", "iguana", "impala",
	"jackal", "jaguar", "jay", "jellyfish", "kangaroo", "kingfisher", "kiwi",
	"koala", "kookabura", "kudu", "labrador", "ladybug", "lapwing", "lark",
	"lemming", "lemur", "leopard", "lion", "llama", "lobster", "loris", "lynx",
	"lyrebird", "magpie", "malamute", "mallard", "mammoth", "manatee",
	"mandrill", "marlin", "marmot", "marten", "mastiff", "meadowlark",
	"meerkat", "mink", "minnow", "mockingbird", "mole", "mongoose", "monitor",
	"moose", "mosquito", "mouse", "mule", "narwhal", "newt", "nightingale",
	"ocelot", "octopus", "okapi", "opossum", "orca", "oriole", "ostrich",
	"otter", "owl", "ox", "oyster", "panda", "panther", "parakeet", "parrot",
	"partridge", "peacock", "peccary", "pelican", "penguin", "perch",
	"pheasant", "pig", "pigeon", "pika", "platypus", "pony", "poodle",
	"porcupine", "porpoise", "possum", "ptarmigan", "puffin", "puma", "quail",
	"rabbit", "raccoon", "ram", "rat", "raven", "reindeer", "retriever",
	"rhinoceros", "roadrunner", "robin", "rook", "rooster", "salamander",
	"salmon", "sandpiper", "sardine", "schnauzer", "scorpion", "seahorse",
	"seal", "setter", "shark", "sheep", "shepherd", "shrimp", "skunk", "snail",
	"snake", "sockeye", "spaniel", "sparrow", "spider", "spoonbill", "squid",
	"squirrel", "starfish", "starling", "stingray", "stoat", "stork",
	"sturgeon", "swan", "swordfish", "tapir", "tern", "terrier", "tiger",
	"toad", "tortoise", "toucan", "trout", "turtle", "viper", "vole",
	"vulture", "walrus", "warbler", "warthog", "weasel", "whale", "wildcat",
	"wildebeest", "wolf", "wolverine", "wombat", "woodpecker", "wren", "yak",
	"zebra",
];

function pick<T>(arr: readonly T[]): T {
	return arr[Math.floor(Math.random() * arr.length)];
}

export function generateSlug(): string {
	const adj = pick(ADJECTIVES);
	const animal = pick(ANIMALS);
	const num = Math.floor(Math.random() * 900) + 100; // 100–999
	return `${adj}-${animal}-${num}`;
}
