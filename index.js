const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require("discord.js");
const http = require("http");
const https = require("https");

const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Bot dziala poprawnie!\n");
});
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Serwer HTTP nasłuchuje na porcie ${PORT}`);
});

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers
    ]
});

const nazwaRoli = "・Members";
const ID_KANALU_LOGOW = "1531657727397462046";
const pendingVerifications = new Map();

// Funkcja zapytania z nagłówkami przeglądarkowymi omijającymi blokadę Roblox
function robloxFetch(url, options = {}, postData = null) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const reqOptions = {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method: options.method || "GET",
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "application/json, text/plain, */*",
                "Accept-Language": "en-US,en;q=0.9",
                "Referer": "https://www.roblox.com/",
                ...(options.headers || {})
            }
        };

        if (postData) {
            const bodyStr = JSON.stringify(postData);
            reqOptions.headers["Content-Type"] = "application/json";
            reqOptions.headers["Content-Length"] = Buffer.byteLength(bodyStr);
        }

        const req = https.request(reqOptions, (res) => {
            let data = "";
            res.on("data", chunk => data += chunk);
            res.on("end", () => {
                try {
                    resolve({ status: res.statusCode, data: JSON.parse(data) });
                } catch (e) {
                    resolve({ status: res.statusCode, data: data });
                }
            });
        });

        req.on("error", err => reject(err));

        if (postData) {
            req.write(JSON.stringify(postData));
        }
        req.end();
    });
}

const commands = [
    new SlashCommandBuilder()
        .setName("weryfikacja")
        .setDescription("Rozpocznij proces weryfikacji konta Roblox")
        .addStringOption(option => 
            option.setName("nazwa")
                  .setDescription("Twoja dokładna nazwa użytkownika w Roblox")
                  .setRequired(true))
].map(command => command.toJSON());

client.once("ready", async () => {
    console.log(`Bot działa jako ${client.user.tag}`);
    const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);
    try {
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands },
        );
        console.log("Pomyślnie zarejestrowano komendy slash.");
    } catch (error) {
        console.error(error);
    }
});

client.on("interactionCreate", async interaction => {
    if (interaction.isChatInputCommand() && interaction.commandName === "weryfikacja") {
        const robloxUser = interaction.options.getString("nazwa");
        const discordId = interaction.user.id;

        try {
            await interaction.deferReply({ ephemeral: true });

            const searchRes = await robloxFetch(
                "https://users.roblox.com/v1/usernames/users",
                { method: "POST" },
                { usernames: [robloxUser], excludeBannedUsers: true }
            );

            if (searchRes.status !== 200 || !searchRes.data.data || searchRes.data.data.length === 0) {
                return interaction.editReply({
                    content: `❌ Nie znaleziono gracza o nazwie **${robloxUser}** na platformie Roblox. Sprawdź poprawność wpisanej nazwy.`
                });
            }

            const robloxId = searchRes.data.data[0].id;
            const verifiedCode = `RBX-${Math.floor(1000 + Math.random() * 9000)}`;

            pendingVerifications.set(discordId, {
                robloxUsername: robloxUser,
                robloxId: robloxId,
                code: verifiedCode
            });

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId("check_verification")
                    .setLabel("Sprawdź weryfikację")
                    .setStyle(ButtonStyle.Success)
            );

            const embed = new EmbedBuilder()
                .setTitle("Weryfikacja konta Roblox")
                .setColor(0x00AE86)
                .setDescription(`Kroki do ukończenia weryfikacji dla **${robloxUser}**:\n\n1. Wejdź na swój profil na Roblox.\n2. Zmień swój **Opis (Bio)** na poniższy kod:\n\`\`\`${verifiedCode}\`\`\`\n3. Gdy już to zrobisz, kliknij przycisk **Sprawdź weryfikację** poniżej.`)
                .setFooter({ text: "Kod można usunąć z profilu po zakończeniu weryfikacji." });

            await interaction.editReply({ embeds: [embed], components: [row] });

        } catch (error) {
            console.error("Błąd wyszukiwania Roblox:", error);
            await interaction.editReply({ content: `❌ Wystąpił błąd podczas kontaktowania się z API Roblox. Spróbuj ponownie później.` });
        }
    }

    if (interaction.isButton() && interaction.customId === "check_verification") {
        const discordId = interaction.user.id;
        const data = pendingVerifications.get(discordId);

        if (!data) {
            return interaction.reply({
                content: `❌ Nie znaleziono aktywnej sesji weryfikacyjnej. Wpisz komendę \`/weryfikacja\` ponownie.`,
                ephemeral: true
            });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            console.log(`Sprawdzanie profilu Roblox ID: ${data.robloxId}`);
            const profileRes = await robloxFetch(`https://users.roblox.com/v1/users/${data.robloxId}`, {
                method: "GET"
            });
            
            if (profileRes.status !== 200) {
                throw new Error(`API Roblox odpowiedziało kodem: ${profileRes.status}`);
            }

            const bio = profileRes.data.description || "";

            if (bio.includes(data.code)) {
                const member = interaction.member;
                const role = interaction.guild.roles.cache.find(r => r.name === nazwaRoli);

                if (!role) {
                    return interaction.editReply({ content: `❌ Błąd konfiguracji bota: Nie znaleziono roli **${nazwaRoli}** na tym serwerze.` });
                }

                await member.roles.add(role);
                pendingVerifications.delete(discordId);

                await interaction.editReply({ content: `✅ **Weryfikacja powiodła się!** Konto zostało pomyślnie powiązane z graczem **${data.robloxUsername}**. Przyznano rolę!` });

                const logChannel = interaction.guild.channels.cache.get(ID_KANALU_LOGOW);
                if (logChannel) {
                    const logEmbed = new EmbedBuilder()
                        .setTitle("Nowa weryfikacja gracza!")
                        .setColor(0x00FF00)
                        .addFields(
                            { name: "Użytkownik Discord", value: `<@${discordId}> (${interaction.user.tag})`, inline: true },
                            { name: "Nazwa Roblox", value: data.robloxUsername, inline: true }
                        )
                        .setTimestamp();

                    await logChannel.send({ embeds: [logEmbed] });
                }

            } else {
                await interaction.editReply({ content: `❌ Nie znaleziono kodu **${data.code}** w opisie (Bio) Twojego profilu Roblox. Upewnij się, że został wklejony i zapisany, a następnie spróbuj ponownie.` });
            }

        } catch (error) {
            console.error("Szczegóły błędu weryfikacji:", error);
            await interaction.editReply({ content: `❌ Wystąpił błąd podczas kontaktowania się z API Roblox. Spróbuj ponownie za chwilę.` });
        }
    }
});

client.login(process.env.TOKEN);
