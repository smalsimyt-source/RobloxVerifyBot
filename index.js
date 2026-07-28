const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require("discord.js");
const http = require("http");

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

            // Pobieramy ID przez zapytanie awaryjne, a jak zablokuje, proszę o wpisanie ID lub szukamy inaczej
            const searchRes = await fetch("https://users.roblox.com/v1/usernames/users", {
                method: "POST",
                headers: { 
                    "Content-Type": "application/json",
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
                },
                body: JSON.stringify({ usernames: [robloxUser], excludeBannedUsers: true })
            });
            const searchData = await searchRes.json();

            if (!searchData.data || searchData.data.length === 0) {
                return interaction.editReply({
                    content: `❌ Nie znaleziono gracza o nazwie **${robloxUser}** na platformie Roblox.`
                });
            }

            const robloxId = searchData.data[0].id;
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
                .setDescription(`Kroki do ukończenia weryfikacji dla **${robloxUser}**:\n\n1. Wejdź na swój profil na Roblox.\n2. Zmień swój **Opis (Bio)** na poniższy kod:\n\`\`\`${verifiedCode}\`\`\`\n3. Gdy już to zrobisz, kliknij przycisk **Sprawdź weryfikację** poniżej.`);

            await interaction.editReply({ embeds: [embed], components: [row] });

        } catch (error) {
            console.error("Błąd wyszukiwania:", error);
            await interaction.editReply({ content: `❌ Render blokuje zapytania do Roblox. Zmień hosting na lokalny komputer lub użyj alternatywnego rozwiązania.` });
        }
    }

    if (interaction.isButton() && interaction.customId === "check_verification") {
        const discordId = interaction.user.id;
        const data = pendingVerifications.get(discordId);

        if (!data) {
            return interaction.reply({
                content: `❌ Sesja wygasła. Wpisz komendę \`/weryfikacja\` ponownie.`,
                ephemeral: true
            });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            // Pobieramy publiczną stronę profilu Roblox jako HTML, co rzadziej trafia na ostrą blokadę Cloudflare dla botów
            const profileRes = await fetch(`https://www.roblox.com/users/${data.robloxId}/profile`, {
                headers: { 
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
                }
            });
            
            const htmlText = await profileRes.text();

            // Sprawdzamy czy kod znajduje się w pobranym HTML profilu gracza
            if (htmlText.includes(data.code)) {
                const member = interaction.member;
                const role = interaction.guild.roles.cache.find(r => r.name === nazwaRoli);

                if (!role) {
                    return interaction.editReply({ content: `❌ Nie znaleziono roli **${nazwaRoli}** na serwerze.` });
                }

                await member.roles.add(role);
                pendingVerifications.delete(discordId);

                await interaction.editReply({ content: `✅ **Weryfikacja powiodła się!** Przyznano rolę dla gracza **${data.robloxUsername}**.` });

                const logChannel = interaction.guild.channels.cache.get(ID_KANALU_LOGOW);
                if (logChannel) {
                    const logEmbed = new EmbedBuilder()
                        .setTitle("Nowa weryfikacja!")
                        .setColor(0x00FF00)
                        .addFields(
                            { name: "Discord", value: `<@${discordId}>`, inline: true },
                            { name: "Roblox", value: data.robloxUsername, inline: true }
                        )
                        .setTimestamp();
                    await logChannel.send({ embeds: [logEmbed] });
                }

            } else {
                await interaction.editReply({ content: `❌ Nie znaleziono kodu **${data.code}** w Bio Twojego profilu Roblox. Upewnij się, że został zapisany.` });
            }

        } catch (error) {
            console.error("Błąd weryfikacji:", error);
            await interaction.editReply({ content: `❌ Serwer hostingowy (Render) ma zablokowany dostęp do Roblox przez Cloudflare. Jedynym darmowym wyjściem jest uruchomienie bota na własnym komputerze.` });
        }
    }
});

client.login(process.env.TOKEN);
