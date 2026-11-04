// Emoji offered as class icons, by category. Any other emoji can still be
// typed in; these are the ones a tap away.

const list = (s: string) => s.trim().split(/\s+/);

export const EMOJI_GROUPS: { name: string; emoji: string[] }[] = [
  {
    name: 'Study',
    emoji: list(`📚 📖 📕 📗 📘 📙 📓 📔 📒 📝 ✏️ ✒️ 🖊️ 🖋️ 🖍️ 📏 📐 📌 📍 📎 🖇️ ✂️ 🗂️ 📁 📂 🗃️ 🗄️ 📋 📅 📆 🗓️ 🎓 🏫 🧑‍🎓 🧑‍🏫 🧠 💡 🔖 🏷️ 📑 🗒️ 📄 📃 📜 📰 🗞️ 💯 ✅ ☑️ ❓ ❗`),
  },
  {
    name: 'Science',
    emoji: list(`🔬 🧪 🧫 🧬 ⚗️ 🔭 📡 🧲 ⚛️ 🌡️ 🩺 💊 💉 🩸 🩻 🦠 🫀 🫁 🦴 🦷 👁️ 🧯 ⚡ 🔋 🔌 💻 🖥️ ⌨️ 🖱️ 💾 💿 🤖 ⚙️ 🔧 🔩 🛠️ 🧮 ➕ ➖ ✖️ ➗ 🟰 ♾️ 📊 📈 📉 🔢 🔣 #️⃣ 🧩`),
  },
  {
    name: 'People',
    emoji: list(`😀 😃 😄 😁 😆 😅 🤣 😂 🙂 😉 😊 😇 🥰 😍 🤩 😘 😋 😛 🤪 🤓 😎 🥸 🤔 🫡 🤗 🤭 🤫 😴 🤯 🥳 😤 😱 🫠 🥹 😬 🙃 👋 👍 👏 🙌 💪 🫶 🙏 ✌️ 🤞 👀 🗣️ 👤 👥 🧑‍⚕️ 🧑‍🔬 🧑‍💻 🧑‍🎨 🧑‍🍳 🧑‍⚖️ 🧑‍🚀 🧑‍🏭 🧑‍🌾 🦸 🧙`),
  },
  {
    name: 'Nature',
    emoji: list(`🌍 🌎 🌏 🗺️ 🏔️ ⛰️ 🌋 🏝️ 🏜️ 🌊 💧 🔥 ☀️ 🌤️ ⛅ 🌧️ ⛈️ ❄️ ☃️ 🌈 🌙 ⭐ 🌟 ✨ ☄️ 🪐 🌱 🌿 ☘️ 🍀 🌵 🌲 🌳 🌴 🍁 🍂 🍃 🌸 🌺 🌻 🌼 🌷 🌹 🪴 🍄 🪨 🐚`),
  },
  {
    name: 'Animals',
    emoji: list(`🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🐔 🐧 🐦 🦆 🦉 🦇 🐺 🐴 🦄 🐝 🐛 🦋 🐌 🐞 🐜 🕷️ 🐢 🐍 🦎 🦖 🦕 🐙 🦑 🦐 🦀 🐡 🐠 🐟 🐬 🐳 🦈 🐊 🐘 🦒 🦓 🦔 🐾`),
  },
  {
    name: 'Food',
    emoji: list(`🍎 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🫐 🍒 🍑 🥭 🍍 🥥 🥝 🍅 🥑 🥦 🥕 🌽 🌶️ 🥔 🥐 🍞 🧀 🥚 🍳 🥞 🥓 🍔 🍟 🍕 🌮 🌯 🥗 🍝 🍜 🍣 🍱 🍙 🍪 🍩 🧁 🍰 🎂 🍫 🍿 ☕ 🍵 🧋 🥤 🧃`),
  },
  {
    name: 'Activities',
    emoji: list(`⚽ 🏀 🏈 ⚾ 🎾 🏐 🏉 🎱 🏓 🏸 🏒 ⛳ 🏹 🥊 🥋 ⛸️ 🎿 🏂 🏋️ 🤸 🧘 🏃 🚴 🏊 🧗 🏆 🥇 🥈 🥉 🏅 🎖️ 🎯 🎮 🕹️ 🎲 ♟️ 🧸 🎨 🖌️ 🎭 🎬 🎤 🎧 🎼 🎵 🎶 🎹 🥁 🎷 🎺 🎸 🎻 📷 🎥`),
  },
  {
    name: 'Places',
    emoji: list(`🏛️ 🏰 🏯 🕌 ⛪ 🛕 🕍 🗽 🗼 🗿 🏟️ 🏠 🏡 🏢 🏥 🏦 🏨 🏪 🏭 🏗️ 🌆 🌃 🌉 🎡 🎢 ⛲ ⛺ 🚗 🚕 🚌 🚑 🚒 🚓 🚲 🛴 🚂 🚆 🚇 ✈️ 🚀 🛸 🚁 ⛵ 🚢 ⚓ 🧭 🗺️`),
  },
  {
    name: 'Objects',
    emoji: list(`💰 💵 💳 🏦 📦 🧾 💼 👜 🎒 🧳 👓 🕶️ 👔 👗 👟 👑 💎 💍 ⌚ 📱 ☎️ 📞 📠 📺 📻 🎙️ ⏰ ⏳ ⌛ 🔑 🗝️ 🔒 🔓 🔨 🪓 ⛏️ 🧰 🧱 🪜 🛏️ 🪑 🚪 🪞 🧴 🧹 🧺 🧻 🧼 💡 🔦 🕯️ 🎁 🎈 🎉 🎊 🪄 🔮 🧿`),
  },
  {
    name: 'Symbols',
    emoji: list(`❤️ 🧡 💛 💚 💙 💜 🤎 🖤 🤍 💖 💗 💓 💞 💕 ❣️ 💔 ☮️ ✝️ ☪️ ☯️ 🕉️ ♈ ♉ ♊ ♋ ♌ ♍ ♎ ♏ ♐ ♑ ♒ ♓ ⚛️ ♻️ ⚠️ 🚫 ⛔ 🔴 🟠 🟡 🟢 🔵 🟣 🟤 ⚫ ⚪ 🟥 🟧 🟨 🟩 🟦 🟪 🔶 🔷 🔺 🔻 💠 🔘 🏳️ 🏴 🚩 🏁 🏳️‍🌈`),
  },
];

export const ALL_EMOJI = EMOJI_GROUPS.flatMap((g) => g.emoji);
