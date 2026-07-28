const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require("discord.js");
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

// Tymczasowa pamięć na kody weryfikacyjne
const pendingVerifications = new Map();

// Definicja komendy panelu (dla administratora, aby wysłał panel na kanał)
const commands = [
    new SlashCommandBuilder()
        .setName("panel-weryfikacji")
        .setDescription("Wysyła publiczny panel weryfikacyjny na ten kanał")
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
    // 1. Komenda /panel-weryfikacji wysyłająca embed z przyciskiem
    if (interaction.isChatInputCommand() && interaction.commandName === "panel-weryfikacji") {
        const embed = new EmbedBuilder()
            .setTitle("Weryfikacja Konta Roblox")
            .setDescription("Kliknij przycisk poniżej, aby rozpocząć proces weryfikacji i otrzymać rangę **" + nazwaRoli + "**.")
            .setColor(0x00AE86);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId("start_verification_modal")
                .setLabel("Zweryfikuj konto")
                .setStyle(ButtonStyle.Primary)
        );

        await interaction.channel.send({ embeds: [embed], components: [row] });
        await interaction.reply({ content: "✅ Pomyślnie wysłano panel weryfikacyjny!", ephemeral: true });
    }

    // 2. Kliknięcie przycisku "Zweryfikuj konto" -> wyskakuje okienko (Modal) na nick z Roblox
    if (interaction.isButton() && interaction.customId === "start_verification_modal") {
        const modal = new ModalBuilder()
            .setCustomId("roblox_modal")
            .setTitle("Weryfikacja Roblox");

        const robloxInput = new TextInputBuilder()
            .setCustomId("roblox_username_input")
            .setLabel("Twój dokładny nick z Roblox")
            .setStyle(TextInputStyle.Short)
            .setPlaceholder("Wpisz tutaj swoją nazwę...")
            .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(robloxInput));
        await interaction.showModal(modal);
    }

    // 3. Obsługa wpisanego nicku z okienka (Modala)
    if (interaction.isModalSubmit() && interaction.customId === "roblox_modal") {
        const robloxUser = interaction.fields.getTextInputValue("roblox_username_input");
        const discordId = interaction.user.id;

        try {
            const userSearchRes = await fetch("https://users.roblox.com/v1/usernames/users", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ usernames: [robloxUser], excludeBannedUsers: true })
            });
            const userData = await userSearchRes.json();

            if (!userData.data || userData.data.length === 0) {
                return interaction.reply({
                    content: `❌ Nie znaleziono gracza o nazwie **${robloxUser}** na platformie Roblox. Spróbuj ponownie.`,
                    ephemeral: true
                });
            }

            const robloxId = userData.data[0].id;
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
                .setTitle("Krok 2: Przypisz kod do profilu")
                .setColor(0x00AE86)
                .setDescription(`Weryfikacja dla gracza **${robloxUser}**:\n\n1. Skopiuj poniższy kod:\n\`\`\`${verifiedCode}\`\`\`\n2. Wejdź na swój profil na Roblox i wklej go w **Opis (Bio)**.\n3. Wróć tutaj i kliknij **Sprawdź weryfikację**.`)
                .setFooter({ text: "Kod możesz usunąć z profilu po pomyślnej weryfikacji." });

            await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });

        } catch (error) {
            console.error(error);
            await interaction.reply({
                content: `❌ Wystąpił błąd podczas kontaktowania się z API Roblox.`,
                ephemeral: true
            });
        }
    }

    // 4. Kliknięcie "Sprawdź weryfikację" i przyznanie roli
    if (interaction.isButton() && interaction.customId === "check_verification") {
        const discordId = interaction.user.id;
        const data = pendingVerifications.get(discordId);

        if (!data) {
            return interaction.reply({
                content: `❌ Sesja wygasła lub nie została rozpoczęta. Kliknij przycisk weryfikacji ponownie.`,
                ephemeral: true
            });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            const profileRes = await fetch(`https://users.roblox.com/v1/users/${data.robloxId}`);
            const profileData = await profileRes.json();
            const bio = profileData.description || "";

            if (bio.includes(data.code)) {
                const member = interaction.member;
                const role = interaction.guild.roles.cache.find(r => r.name === nazwaRoli);

                if (!role) {
                    return interaction.editReply({ content: `❌ Błąd: Nie znaleziono roli **${nazwaRoli}** na serwerze.` });
                }

                await member.roles.add(role);
                pendingVerifications.delete(discordId);

                await interaction.editReply({ content: `✅ **Weryfikacja powiodła się!** Konto połączone z **${data.robloxUsername}**. Otrzymałeś rolę!` });

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
                await interaction.editReply({ content: `❌ Nie znaleziono kodu **${data.code}** w opisie Twojego profilu Roblox. Upewnij się, że został zapisany!` });
            }

        } catch (error) {
            console.error(error);
            await interaction.editReply({ content: `❌ Wystąpił błąd podczas sprawdzania profilu. Spróbuj ponownie.` });
        }
    }
});

client.login(process.env.TOKEN);
