import { SQLiteDatabase } from 'expo-sqlite';

type RandomLoreArchetypeSeed = {
  name: string;
  allowedClasses: string[];
  traits: string[];
  ideals: string[];
  bonds: string[];
  flaws: string[];
  backstory: string[];
  allies: string[];
  features: string[];
  extraLanguages: string[];
};

const RANDOM_LORE_ARCHETYPES: RandomLoreArchetypeSeed[] = [
  {
    "name": "O Malandro das Ruas",
    "allowedClasses": [
      "Ladino",
      "Bardo",
      "Guerreiro",
      "Bruxo",
      "Monge"
    ],
    "traits": [
      "Sempre encontro uma forma de rir, mesmo nas piores situações.",
      "Sempre desconfio das intenções de estranhos antes de confiar.",
      "Gosto de testar os limites das pessoas só para ver como reagem.",
      "Tenho dificuldade em levar qualquer autoridade a sério.",
      "Falo o que penso, mesmo quando deveria ficar calado."
    ],
    "ideals": [
      "Liberdade. Correntes são feitas para serem quebradas.",
      "Caos. A ordem excessiva sufoca a vida.",
      "Comunidade. Devemos cuidar uns dos outros para sobreviver."
    ],
    "bonds": [
      "Fui expulso da minha vila e um dia voltarei para provar meu valor.",
      "Tenho um rival que jurei superar em tudo.",
      "Estou em busca de um ente querido que desapareceu há anos."
    ],
    "flaws": [
      "Tenho um vício em jogos de cartas que sempre me deixa pobre.",
      "Impulsivo, ajo antes de pensar se a emoção falar mais alto.",
      "Costumo mentir mesmo quando não há necessidade.",
      "Não sei lidar bem com autoridade."
    ],
    "backstory": [
      "Cresci nas ruas da capital, aprendendo a sobreviver desde cedo furtando pães e frutas nas feiras.",
      "Fui acusado injustamente de um crime e agora vivo fugindo.",
      "Trabalhava como capanga de um agiota, até o dia em que decidi roubar dele e fugir."
    ],
    "allies": [
      "Tenho uma dívida eterna com a Taverneira do \"Javali Saltitante\".",
      "Mantenho contato obscuro com o sindicato de contrabandistas do cais.",
      "Tenho um informante nas masmorras da cidade.",
      "Possuo um contato no mercado negro."
    ],
    "features": [
      "Consigo dormir profundamente em qualquer lugar, mesmo no chão de pedra.",
      "Minha sombra parece se mover um segundo atrasada.",
      "Tenho uma tolerância absurdamente alta para bebidas fortes."
    ],
    "extraLanguages": [
      "Goblin",
      "Subcomum",
      "Símbolos Secretos de Ladrões",
      "Proficiência com Cartas de Baralho"
    ]
  },
  {
    "name": "O Devoto Fanático",
    "allowedClasses": [
      "Clérigo",
      "Paladino",
      "Monge"
    ],
    "traits": [
      "Tudo o que faço é em nome da minha fé.",
      "Vejo sinais divinos em pequenos acontecimentos.",
      "Tenho dificuldade em entender quem não segue uma crença.",
      "Costumo citar escrituras em momentos inadequados."
    ],
    "ideals": [
      "Fé. A verdadeira força vem da devoção absoluta.",
      "Sacrifício. Grandes recompensas exigem grandes renúncias.",
      "Purificação. O mal deve ser erradicado pela raiz."
    ],
    "bonds": [
      "Protejo um templo que foi quase destruído.",
      "Minha vida pertence à divindade que me salvou.",
      "Carrego uma relíquia sagrada que não pode cair em mãos erradas."
    ],
    "flaws": [
      "Sou intolerante com crenças opostas.",
      "Posso ir longe demais ao tentar \"corrigir\" alguém.",
      "Confundo minha vontade com a vontade divina."
    ],
    "backstory": [
      "Sobrevivi a uma tragédia que acredito ter sido intervenção divina.",
      "Fui criado dentro de um templo e nunca conheci outra vida.",
      "Recebi uma visão profética que mudou meu destino de uma hora para a outra."
    ],
    "allies": [
      "Sou respeitado por membros de minha ordem religiosa.",
      "Recebo apoio discreto de um sacerdote influente.",
      "Possuo contato com um inquisidor da fé."
    ],
    "features": [
      "Minha presença intimida hereges e cultistas.",
      "Minha voz ecoa com autoridade quando falo de fé.",
      "Possuo marcas sagradas discretas pelo corpo."
    ],
    "extraLanguages": [
      "Celestial",
      "Infernal",
      "Proficiência com Kit de Caligrafia",
      "Abissal"
    ]
  },
  {
    "name": "O Alquimista/Estudioso Obcecado",
    "allowedClasses": [
      "Mago",
      "Feiticeiro",
      "Ladino",
      "Bruxo",
      "Artífice"
    ],
    "traits": [
      "Anoto tudo em cadernos cheios de fórmulas e desenhos.",
      "Vejo potencial explosivo em objetos comuns.",
      "Fico empolgado demais ao testar hipóteses perigosas.",
      "Perco a noção do tempo quando estou pesquisando algo novo."
    ],
    "ideals": [
      "Descoberta. Sempre há algo novo a ser criado ou entendido.",
      "Transformação. Nada é fixo; tudo pode mudar.",
      "Ambição. O impossível é apenas uma questão de tentativa e erro."
    ],
    "bonds": [
      "Busco aperfeiçoar a fórmula mágica que matou meu antigo mentor.",
      "Protejo um manuscrito raro que contém conhecimento proibido.",
      "Prometi achar a cura para uma praga que assola minha região."
    ],
    "flaws": [
      "Subestimo riscos de experimentos e feitiços instáveis.",
      "Tenho dificuldade extrema em aceitar falhas.",
      "Às vezes trato pessoas como cobaias involuntárias."
    ],
    "backstory": [
      "Fui aprendiz de um mestre excêntrico, até que o laboratório explodiu e tive que fugir.",
      "Acabei expulso de uma academia mágica por práticas perigosas.",
      "Descobri cedo meu talento para manipular substâncias raras e energias voláteis."
    ],
    "allies": [
      "Tenho contato com um fornecedor de ingredientes exóticos.",
      "Recebo cartas criptografadas de um antigo colega de estudos.",
      "Conheço um médico disposto a testar novas misturas sem fazer perguntas."
    ],
    "features": [
      "Cheiro constantemente a reagentes químicos e pergaminho velho.",
      "Tenho pequenas queimaduras antigas nas pontas dos dedos.",
      "Carrego frascos escondidos em bolsos secretos nas roupas."
    ],
    "extraLanguages": [
      "Dracônico",
      "Proficiência com Kit de Alquimia",
      "Proficiência com Kit de Herbalismo",
      "Primordial"
    ]
  },
  {
    "name": "O Navegador Errante",
    "allowedClasses": [
      "Bardo",
      "Guerreiro",
      "Ladino",
      "Patrulheiro"
    ],
    "traits": [
      "Sempre conto histórias do mar, mesmo quando ninguém pediu.",
      "Confio mais em mapas antigos do que em pessoas novas.",
      "Acredito que o horizonte sempre guarda algo melhor do que o porto seguro.",
      "Tenho extrema dificuldade em ficar muito tempo no mesmo lugar."
    ],
    "ideals": [
      "Liberdade. O mar e as estradas não pertencem a ninguém.",
      "Descoberta. Sempre há novas rotas a serem traçadas.",
      "Camaradagem. Uma tripulação unida sobrevive a qualquer tempestade."
    ],
    "bonds": [
      "Procuro um porto lendário que poucos acreditam existir.",
      "Minha antiga tripulação foi destruída por piratas sanguinolentos.",
      "Tenho um mapa incompleto que pode mudar a geografia do mundo conhecido."
    ],
    "flaws": [
      "Sou extremamente supersticioso quanto a presságios marítimos e climáticos.",
      "Bebo além da conta quando estou muito tempo em terra firme.",
      "Não resisto a uma aposta perigosa se envolver navegação ou rotas."
    ],
    "backstory": [
      "Cresci esfregando o convés de um navio mercante.",
      "Sou o único sobrevivente de um naufrágio provocado por uma fera misteriosa.",
      "Fugi de uma família abusiva para viver aventuras no mar sem fim."
    ],
    "allies": [
      "Tenho amizade fiel com um capitão aposentado e rabugento.",
      "Sou bem-vindo em certos portos costeiros barra-pesada.",
      "Mantenho contato com cartógrafos independentes."
    ],
    "features": [
      "Sinto mudanças no vento antes mesmo que aconteçam.",
      "Tenho um equilíbrio excelente, mesmo em terreno muito instável.",
      "Reconheço rotas e constelações com uma batida de olho."
    ],
    "extraLanguages": [
      "Primordial",
      "Proficiência com Ferramentas de Navegação",
      "Aquan",
      "Proficiência com Veículos Aquáticos"
    ]
  },
  {
    "name": "O Assassino Calculista",
    "allowedClasses": [
      "Ladino",
      "Patrulheiro",
      "Monge",
      "Guerreiro"
    ],
    "traits": [
      "Raramente demonstro emoções ou levanto a voz.",
      "Observo padrões de comportamento antes de agir ou falar com alguém.",
      "Prefiro resolver problemas da forma mais rápida e silenciosa possível.",
      "Nunca faço ameaças vazias."
    ],
    "ideals": [
      "Eficiência. O método mais limpo e letal é sempre o melhor.",
      "Contrato. Um acordo selado deve ser cumprido, independente do alvo.",
      "Equilíbrio. Às vezes, a morte de um é necessária para a sobrevivência de muitos."
    ],
    "bonds": [
      "Tenho uma dívida impagável com o mestre que me ensinou a lutar e desaparecer.",
      "Busco vingança implacável contra quem traiu minha antiga guilda.",
      "Protejo alguém importante que não faz a menor ideia da minha real profissão."
    ],
    "flaws": [
      "Tenho dificuldade gigantesca em confiar em aliados recém-chegados.",
      "Subestimo o afeto e a compaixão como um fator de risco.",
      "Vejo a maioria das pessoas apenas como peças em um tabuleiro."
    ],
    "backstory": [
      "Fui treinado desde jovem por uma guilda clandestina que não tolerava falhas.",
      "Fui traído e deixado para morrer por meu antigo contratante.",
      "Era um espião a serviço de um lorde corrupto, mas decidi trabalhar por conta própria."
    ],
    "allies": [
      "Tenho contato direto com um informante do submundo.",
      "Possuo acesso a um falsificador talentosíssimo.",
      "Sou conhecido - e temido - por um pequeno círculo de mercadores ilegais."
    ],
    "features": [
      "Meus passos são quase inaudíveis, não importa o calçado.",
      "Nunca esqueço a rotina de um alvo após observá-lo por um dia.",
      "Mantenho lâminas minúsculas escondidas em locais improváveis do corpo."
    ],
    "extraLanguages": [
      "Símbolos Secretos de Ladrões",
      "Proficiência com Kit de Disfarce",
      "Proficiência com Kit de Veneno",
      "Subcomum"
    ]
  },
  {
    "name": "O Combatente Disciplinado",
    "allowedClasses": [
      "Guerreiro",
      "Paladino",
      "Bárbaro",
      "Monge"
    ],
    "traits": [
      "Não tenho tempo para brincadeiras, sou completamente focado no objetivo.",
      "Não confio em sorte mágica, apenas no meu treino e preparação física.",
      "Prefiro observar o campo de batalha em silêncio antes de desferir o primeiro golpe."
    ],
    "ideals": [
      "Honra. Se eu der minha palavra, eu a cumprirei, custe o que custar.",
      "Justiça. Os culpados sempre devem pagar na mesma moeda.",
      "Proteção. Os fracos e inocentes devem ser defendidos por aqueles que são fortes."
    ],
    "bonds": [
      "Luto para proteger aqueles que não conseguem empunhar uma arma.",
      "Minha honra está eternamente ligada ao nome manchado da minha família.",
      "Devo minha vida a um aventureiro veterano que me salvou da morte certa no passado."
    ],
    "flaws": [
      "Guardo rancor por tempo demais, às vezes anos.",
      "Sou praticamente incapaz de recusar um desafio direto às minhas habilidades.",
      "Tenho um temperamento rígido que muitas vezes aliena meus aliados.",
      "Tenho extrema dificuldade em admitir quando meu plano tático está errado."
    ],
    "backstory": [
      "Fui um antigo guarda da cidade que se cansou da corrupção dos nobres, jogou o distintivo fora e pegou a estrada.",
      "Servi bravamente no exército durante uma guerra violenta que o reino preferiu esquecer.",
      "Sou sobrevivente de um ataque de saqueadores; jurei treinar até que nunca mais fosse fraco."
    ],
    "allies": [
      "Sou bastante respeitado por um pequeno clã de mercenários independentes.",
      "Tenho amizade velada com um capitão da guarda local.",
      "Tenho um velho companheiro de batalhões sempre disposto a ajudar por uma caneca de cerveja."
    ],
    "features": [
      "Possuo dezenas de cicatrizes de batalha, cada uma com uma história militar.",
      "Tenho memória afiada para terrenos e posições táticas.",
      "Nunca esqueço o rosto de quem já lutou ao meu lado - ou contra mim."
    ],
    "extraLanguages": [
      "Gigante",
      "Orc",
      "Proficiência com Ferramentas de Ferreiro",
      "Proficiência com Ferramentas de Carpinteiro"
    ]
  },
  {
    "name": "O Estudioso Místico",
    "allowedClasses": [
      "Mago",
      "Bruxo",
      "Clérigo",
      "Bardo",
      "Druida"
    ],
    "traits": [
      "Fico instantaneamente fascinado com qualquer relíquia ou bugiganga arcana.",
      "Tenho uma curiosidade perigosa, grande demais para o meu próprio bem.",
      "Sempre tento mediar conflitos usando lógica e razão antes que virem violência desenfreada."
    ],
    "ideals": [
      "Conhecimento. A verdade oculta está acima de qualquer poder temporal.",
      "Destino. Meu caminho e minhas descobertas já foram traçados por forças maiores.",
      "Equilíbrio. A magia da luz e as artes das trevas precisam coexistir para o mundo não ruir.",
      "Iluminação. Todos merecem compartilhar o dom da sabedoria."
    ],
    "bonds": [
      "Protejo um segredo ancestral que, se revelado, poderia iniciar uma guerra santa.",
      "Devo lealdade irrestrita a uma ordem hermética que o povo acha que já não existe mais.",
      "Fui salvo de uma maldição por uma entidade misteriosa e sinto que a ela devo a vida."
    ],
    "flaws": [
      "Confio rápido demais em promessas intelectuais e charadas.",
      "Frequentemente subestimo inimigos braçais que me parecem estúpidos ou fracos.",
      "Fico incrivelmente paranoico quando sinto perturbações no tecido mágico local.",
      "Posso sacrificar minha própria segurança por um livro raro."
    ],
    "backstory": [
      "Eu era um arquivista de biblioteca que percebeu que ler sobre o mundo não era nada comparado a desvendá-lo pessoalmente.",
      "Fui treinado arduamente em um mosteiro místico isolado no topo das montanhas.",
      "Era aprendiz de um arquimago excêntrico que desapareceu subitamente sem deixar um único rastro físico.",
      "Escapei por pouco de um culto sombrio tentando invocar coisas que não deveriam despertar."
    ],
    "allies": [
      "Recebo permissões especiais em grandes bibliotecas e academias de magia.",
      "Sou observado e ocasionalmente ajudado por um corvo familiar ou criatura feérica.",
      "Sou membro de base de uma aliança secreta de arcanistas espalhados pelo continente.",
      "Possuo um mestre ancião que envia mensagens mágicas enigmáticas de vez em quando."
    ],
    "features": [
      "Possuo uma tatuagem mística ou cicatriz rúnica que formiga perto de magia intensa.",
      "Minhas mãos são sempre frias ao toque, independentemente do clima escaldante.",
      "Meus olhos mudam levemente de tonalidade quando eu conjuro ou concentro energia."
    ],
    "extraLanguages": [
      "Celestial",
      "Silvestre",
      "Abissal",
      "Proficiência com Ferramentas de Caligrafia"
    ]
  },
  {
    "name": "O Nobre Vaidoso",
    "allowedClasses": [
      "Bardo",
      "Paladino",
      "Feiticeiro",
      "Guerreiro"
    ],
    "traits": [
      "Acredito veementemente que o dinheiro e a influência resolvem absolutamente qualquer problema.",
      "Sou excessivamente educado, de forma condescendente, até com meus piores inimigos.",
      "Adoro monopolizar a conversa com histórias exageradas sobre minhas proezas.",
      "Detesto sujeira e reclamo frequentemente da falta de conforto."
    ],
    "ideals": [
      "Poder. Eu farei o que for preciso para elevar o prestígio da minha linhagem.",
      "Glória. Quero que meu nome seja eternizado em estátuas de mármore e canções épicas.",
      "Noblesse Oblige. É meu dever guiar as massas não instruídas, pois sou superior.",
      "Tradição. O sangue nobre e as antigas formas de governar existem por um excelente motivo."
    ],
    "bonds": [
      "Guardo o anel de sinete da minha casa, a única prova do meu verdadeiro berço.",
      "Jurei limpar o nome da minha família após um escândalo político arruinar nosso feudo.",
      "Carrego comigo uma joia de valor inestimável que pertenceu à minha falecida mãe."
    ],
    "flaws": [
      "No fundo, acredito que sou ontologicamente superior a todos que não têm berço de ouro.",
      "Sou obcecado por aparências físicas, vestimentas luxuosas e culinária fina.",
      "Tenho um medo paralisante de falhar, passar vergonha ou parecer fraco em público.",
      "Suborno as pessoas impulsivamente em vez de lidar com os problemas."
    ],
    "backstory": [
      "Nasci cercado de veludo e servos, mas um golpe de estado tirou tudo de mim, forçando-me a aventurar.",
      "Descobri recentemente que sou o filho bastardo de um regente importantíssimo.",
      "Entediei-me com a política letárgica da corte e fugi em busca de emoções reais no mundo sujo.",
      "Fui deserdado por desonrar minha casa paterna e agora busco glória para esfregar na cara deles."
    ],
    "allies": [
      "Ainda mantenho o favor de alguns cortesãos leais e servos saudosos do castelo.",
      "Tenho amizade com comandantes da guarda real que outrora protegeram minha família.",
      "Possuo crédito (e muitas dívidas) nos maiores bancos mercantis da capital central.",
      "Sou apadrinhado à distância por um duque de reputação questionável."
    ],
    "features": [
      "Tenho uma risada polida e inconfundível, acompanhada de um olhar de cima para baixo.",
      "Meu sotaque denuncia imediatamente uma criação requintada e anos de tutores particulares.",
      "Caminho com uma postura reta tão artificial que pareço carregar uma tábua nas costas."
    ],
    "extraLanguages": [
      "Dracônico",
      "Proficiência com Instrumentos de Sopro",
      "Élfico (Alta Sociedade)",
      "Proficiência com Ferramentas de Joalheiro"
    ]
  },
  {
    "name": "O Forasteiro Selvagem",
    "allowedClasses": [
      "Bárbaro",
      "Druida",
      "Patrulheiro"
    ],
    "traits": [
      "Sou profundamente supersticioso, interpretando o voo dos pássaros e o uivo dos lobos.",
      "Sempre desconfio das invenções da \"civilização\" e durmo com um olho aberto em cidades.",
      "Prefiro ficar em silêncio absoluto observando os arredores antes de abrir a boca.",
      "Fico tenso em locais fechados ou multidões esmagadoras."
    ],
    "ideals": [
      "Exploração. O mundo natural precisa ter seus cantos respeitados, não pavimentados.",
      "Autossuficiência. Eu sou a minha própria arma; só posso depender do meu suor e sangue.",
      "Harmonia Primordial. O ciclo de presa e predador é sagrado e não deve ser corrompido.",
      "Liberdade. As paredes das cidades são apenas gaiolas enfeitadas com pedras."
    ],
    "bonds": [
      "Meu clã foi dizimado por bestas, e jurei caçar até o último responsável na face da terra.",
      "Sou o guardião ungido de um bosque ancestral que a civilização tenta invadir.",
      "Tenho uma conexão empática inexplicável com um predador que me salvou na juventude."
    ],
    "flaws": [
      "Tenho o hábito perturbador de guardar troféus macabros de minhas caçadas.",
      "Sou impulsivo para a fúria se insultarem meus costumes ou a natureza ao meu redor.",
      "Tenho pavor de magia necromântica e abominações que quebram o ciclo natural da vida.",
      "Somo péssimo com etiquetas sociais e falo brutalmente o que me vem à cabeça."
    ],
    "backstory": [
      "Sobrevivi sozinho na selva brutal por dez anos após me separar da minha tribo em uma tempestade.",
      "Fui criado e moldado pelas feéricas profundas em uma floresta esquecida pelo tempo.",
      "Era um rastreador de recompensas nas estepes congeladas do norte, acostumado ao sangue no gelo.",
      "Nasci durante uma tempestade mística e meu povo sempre me viu como um avatar da fúria elemental."
    ],
    "allies": [
      "Não tenho senhores; minha aliança primária é com a própria terra e as feras locais.",
      "Sou respeitado e temido por tribos nômades que conhecem meu nome de caça.",
      "Uma cabala de druidas eremitas ocasionalmente me fornece ervas e direção.",
      "Tenho passe-livre em territórios controlados por centauros e outros povos silvestres."
    ],
    "features": [
      "Tenho um senso de direção magnético; quase nunca me perco sob céu aberto.",
      "Consigo imitar perfeitamente o som de alarme de pássaros e ganidos de lobos.",
      "Sinto o cheiro metálico de chuva e o ozônio de tempestades horas antes delas caírem.",
      "A maioria dos animais domésticos parece se intimidar ou reverenciar minha presença física."
    ],
    "extraLanguages": [
      "Silvestre",
      "Primordial",
      "Proficiência com Instrumentos de Percussão",
      "Proficiência em Kit de Herbalismo"
    ]
  }
];

const RANDOM_NAME_SEED = {
  "maleNames": [
    "Bruno",
    "João",
    "Pedro",
    "Bentinho",
    "Tiago",
    "Rafael",
    "Kaelen",
    "Thorin",
    "Silas",
    "Bram",
    "Dorian",
    "Faelan",
    "Gael",
    "Orion",
    "Beren",
    "Nícolas",
    "Zoltan",
    "Vagner",
    "Rurik",
    "Luiz",
    "Gustavo",
    "Leonardo",
    "Matheus",
    "Felipe",
    "Wilker",
    "Dante",
    "Vítor",
    "Enzo",
    "Ramon",
    "Aldric",
    "Cedric",
    "Theron",
    "Kael",
    "Edrin",
    "Lucan",
    "Magnus",
    "Hadrian",
    "Alaric",
    "Tiberius",
    "Cassian",
    "Rowan",
    "Darion",
    "Valen",
    "Arthos",
    "Kieran",
    "Ulric",
    "Fenris",
    "Maelor",
    "Talon",
    "Aeron",
    "Gareth",
    "Eamon",
    "Soren",
    "Draven"
  ],
  "femaleNames": [
    "Karoline",
    "Maria",
    "Ana",
    "Beatriz",
    "Mariana",
    "Amanda",
    "Lyra",
    "Elara",
    "Ilyana",
    "Ayla",
    "Morgana",
    "Bianca",
    "Catarine",
    "Fernanda",
    "Isabela",
    "Sofia",
    "Camila",
    "Larissa",
    "Yanaele",
    "Evelyn",
    "Alícia",
    "Lívia",
    "Giovanna",
    "Carla",
    "Júlia",
    "Seraphine",
    "Nyx",
    "Thalia",
    "Isolde",
    "Rhiannon",
    "Selene",
    "Freya",
    "Arwen",
    "Kaelis",
    "Vespera",
    "Aurora",
    "Elysia",
    "Maeryn",
    "Zara",
    "Lyanna",
    "Ophelia",
    "Kallista",
    "Ysolda",
    "Miriel",
    "Aerin",
    "Velanna",
    "Lunara",
    "Sylphie"
  ],
  "classTitlesMale": {
    "Bárbaro": [
      "o Bárbaro",
      "o Implacável",
      "o Feroz",
      "o Quebra-Crânios"
    ],
    "Bardo": [
      "o Bardo",
      "o Cancioneiro",
      "o Galante",
      "Voz-de-Ouro"
    ],
    "Bruxo": [
      "o Bruxo",
      "o Amaldiçoado",
      "o Ocultista",
      "Corta-Sombras"
    ],
    "Clérigo": [
      "o Clérigo",
      "o Devoto",
      "o Curandeiro",
      "Luz-Divina",
      "Bicuda Santa",
      "Bazuca Celestial"
    ],
    "Druida": [
      "o Druida",
      "o Selvagem",
      "Fala-com-Feras",
      "da Floresta"
    ],
    "Feiticeiro": [
      "o Feiticeiro",
      "o Nato",
      "Sangue-Mágico",
      "o Canalizador"
    ],
    "Guerreiro": [
      "o Guerreiro",
      "o Veterano",
      "Braço-de-Ferro",
      "o Colosso"
    ],
    "Ladino": [
      "o Ladino",
      "Pé-Ligeiro",
      "Mão-Leve",
      "o Vigarista",
      "das Sombras"
    ],
    "Mago": [
      "o Mago",
      "o Sábio",
      "o Estudioso",
      "Tomo-Vivo"
    ],
    "Monge": [
      "o Monge",
      "Punho-de-Aço",
      "o Calmo",
      "Passo-Leve"
    ],
    "Paladino": [
      "o Paladino",
      "o Justo",
      "o Cruzado",
      "Escudo-Radiante"
    ],
    "Patrulheiro": [
      "o Patrulheiro",
      "o Caçador",
      "Olho-de-Águia",
      "o Errante"
    ]
  },
  "classTitlesFemale": {
    "Bárbaro": [
      "a Bárbara",
      "a Implacável",
      "a Feroz",
      "a Quebra-Crânios"
    ],
    "Bardo": [
      "a Barda",
      "a Cancioneira",
      "a Galante",
      "Voz-de-Ouro"
    ],
    "Bruxo": [
      "a Bruxa",
      "a Amaldiçoada",
      "a Ocultista",
      "Corta-Sombras"
    ],
    "Clérigo": [
      "a Clériga",
      "a Devota",
      "a Curandeira",
      "Luz-Divina",
      "Bicuda Santa",
      "Bazuca Celestial"
    ],
    "Druida": [
      "a Druida",
      "a Selvagem",
      "Fala-com-Feras",
      "da Floresta"
    ],
    "Feiticeiro": [
      "a Feiticeira",
      "a Nata",
      "Sangue-Mágico",
      "a Canalizadora"
    ],
    "Guerreiro": [
      "a Guerreira",
      "a Veterana",
      "Braço-de-Ferro",
      "a Colosso"
    ],
    "Ladino": [
      "a Ladina",
      "Pé-Ligeiro",
      "Mão-Leve",
      "a Vigarista",
      "das Sombras"
    ],
    "Mago": [
      "a Maga",
      "a Sábia",
      "a Estudiosa",
      "Tomo-Vivo"
    ],
    "Monge": [
      "a Monge",
      "Punho-de-Aço",
      "a Calma",
      "Passo-Leve"
    ],
    "Paladino": [
      "a Paladina",
      "a Justa",
      "a Cruzada",
      "Escudo-Radiante"
    ],
    "Patrulheiro": [
      "a Patrulheira",
      "a Caçadora",
      "Olho-de-Águia",
      "a Errante"
    ]
  },
  "genericTitlesMale": [
    "de Tal",
    "Sem-Teto",
    "da Taberna",
    "o Azarado",
    "o Magnífico",
    "meio Tan Tan",
    "o Errante",
    "o Imortal",
    "o Inquebrável",
    "o Destemido",
    "o Caído",
    "o Renascido",
    "Sangue-de-Ferro",
    "Sussurro-da-Noite",
    "Punho-Sombrio",
    "Lâmina-Veloz",
    "de Rívia",
    "Universitário",
    "Pedra de tropeço",
    "Batutinha"
  ],
  "genericTitlesFemale": [
    "de Tal",
    "Sem-Teto",
    "da Taberna",
    "a Azarada",
    "a Magnífica",
    "meio Tan Tan",
    "a Errante",
    "a Imortal",
    "a Inquebrável",
    "a Destemida",
    "a Caída",
    "a Renascida",
    "Sangue-de-Ferro",
    "Sussurro-da-Noite",
    "Punho-Sombrio",
    "Lâmina-Veloz",
    "de Rívia",
    "Universitária",
    "Pedra de tropeço",
    "Batutinha"
  ]
};

const RANDOM_LORE_CONNECTORS = [
  'O destino e a dureza da vida acabaram forjando minhas habilidades como {classe}.',
  'Abraçar o caminho de {classe} foi a única maneira que encontrei para sobreviver a esse passado.',
  'Essa história me deixou marcas profundas e despertou minha vocação como {classe}.',
];

const RANDOM_RACE_LANGUAGE_RULES = [
  { raceContains: 'Elfo', baseLanguages: 'Comum, Élfico', priority: 90 },
  { raceContains: 'Anão', baseLanguages: 'Comum, Anão', priority: 80 },
  { raceContains: 'Halfling', baseLanguages: 'Comum, Halfling', priority: 70 },
  { raceContains: 'Draconato', baseLanguages: 'Comum, Dracônico', priority: 60 },
  { raceContains: 'Gnomo', baseLanguages: 'Comum, Gnômico', priority: 50 },
  { raceContains: 'Orc', baseLanguages: 'Comum, Orc', priority: 40 },
  { raceContains: 'Tiefling', baseLanguages: 'Comum, Infernal', priority: 30 },
  { raceContains: 'Githyanki', baseLanguages: 'Comum, Gith (Subcomum)', priority: 100 },
  { raceContains: '*', baseLanguages: 'Comum e mais um idioma racial à escolha', priority: 0 },
];

const BG3_EXTRAS = {
  "Astarion": {
    "langs": "Comum, Élfico, Subcomum.\nProficiência: Ferramentas de Ladrão, Kit de Disfarce.",
    "traits": "Vampiro Gerado: Não envelhece, precisa de sangue para sustento. Resiste ao sol graças ao parasita ilitide. Possui cicatrizes infernais nas costas."
  },
  "Lae'zel": {
    "langs": "Comum, Gith.\nProficiência: Navegação Astral.",
    "traits": "Treinamento Militar da Creche K'liir: Conhecimento tático sobre devoradores de mentes. Foco militar implacável e parasita adormecido."
  },
  "Gale": {
    "langs": "Comum, Élfico, Dracônico, Celestial.\nProficiência: Tabuleiros de Xadrez de Lança.",
    "traits": "Prodígio de Waterdeep: Carrega um fragmento corrompido da Trama Netheresa no peito (Orbe) que exige consumo de magia. Mantém Tara, uma tressym, como familiar."
  },
  "Shadowheart": {
    "langs": "Comum, Élfico.\nProficiência: Kit de Venenos, Ferramentas de Ladrão.",
    "traits": "Agente de Shar: Memórias seladas voluntariamente para proteger os segredos do claustro. Possui uma marca mágica na mão que ocasionalmente causa intensa dor."
  },
  "ShadowHeart": {
    "langs": "Comum, Élfico.\nProficiência: Kit de Venenos, Ferramentas de Ladrão.",
    "traits": "Agente de Shar: Memórias seladas voluntariamente para proteger os segredos do claustro. Possui uma marca mágica na mão que ocasionalmente causa intensa dor."
  },
  "Umbralma": {
    "langs": "Comum, Élfico.\nProficiência: Kit de Venenos, Ferramentas de Ladrão.",
    "traits": "Agente de Shar: Memórias seladas voluntariamente para proteger os segredos do claustro. Possui uma marca mágica na mão que ocasionalmente causa intensa dor."
  },
  "Karlach": {
    "langs": "Comum, Infernal.\nProficiência: Veículos terrestres (Máquinas de Avernus).",
    "traits": "Motor Infernal: O coração foi substituído por um motor de Zariel que queima com o calor do inferno. Impossibilitada de tocar as pessoas sem queimá-las no plano material."
  },
  "Wyll": {
    "langs": "Comum, Infernal.\nProficiência: Jogos de Cartas e Dados.",
    "traits": "A Lâmina da Fronteira: Fama como caçador de monstros heroico. Possui um olho de envio de pedra que pertence à sua patrona demônio, Mizora."
  },
  "Halsin": {
    "langs": "Comum, Élfico, Silvestre, Primordial.\nProficiência: Kit de Herbalismo.",
    "traits": "Ancião do Bosque: Porte físico colossal de urso. Conhecimento ancestral sobre rituais da natureza e sobre a Maldição das Sombras que aflige as terras de Ketheric."
  },
  "Jaheira": {
    "langs": "Comum, Élfico, Silvestre.\nProficiência: Kit de Venenos, Ferramentas de Navegação.",
    "traits": "Alto Harpista: Lidera uma rede de espiões e informantes. Possui conhecimento tático de séculos atrás e guarda em sua casa relíquias de aventuras passadas."
  },
  "Minsc": {
    "langs": "Comum.\nProficiência: Nenhuma em especial, mas Boo compensa.",
    "traits": "Herói de Rashemen: Possui uma força de vontade e fúria indomáveis. Sempre acompanhado por Boo, seu fiel Hamster Espacial Gigante em Miniatura, a quem pede conselhos."
  }
};

async function insertRandomNamePart(
  db: SQLiteDatabase,
  gender: 'male' | 'female' | 'any',
  kind: 'first_name' | 'title',
  value: string,
  className: string | null = null,
) {
  await db.runAsync(
    `INSERT OR IGNORE INTO random_name_parts (gender, kind, class_name, value, criador)
     VALUES (?, ?, ?, ?, 'base')`,
    [gender, kind, className || '', value],
  );
}

export async function seedRandomCreatorContent(db: SQLiteDatabase) {
  for (const archetype of RANDOM_LORE_ARCHETYPES) {
    await db.runAsync(
      `INSERT OR IGNORE INTO random_lore_archetypes (name, allowed_classes, criador) VALUES (?, ?, 'base')`,
      [archetype.name, JSON.stringify(archetype.allowedClasses)],
    );

    const row = await db.getFirstAsync<{ id: number }>(
      `SELECT id FROM random_lore_archetypes WHERE name = ? LIMIT 1`,
      [archetype.name],
    );
    if (!row?.id) continue;

    const fields: Array<keyof Pick<RandomLoreArchetypeSeed, 'traits' | 'ideals' | 'bonds' | 'flaws' | 'backstory' | 'allies' | 'features' | 'extraLanguages'>> = [
      'traits', 'ideals', 'bonds', 'flaws', 'backstory', 'allies', 'features', 'extraLanguages',
    ];

    for (const field of fields) {
      for (const value of archetype[field]) {
        await db.runAsync(
          `INSERT OR IGNORE INTO random_lore_entries (archetype_id, field, value, criador) VALUES (?, ?, ?, 'base')`,
          [row.id, field, value],
        );
      }
    }
  }

  for (const name of RANDOM_NAME_SEED.maleNames) await insertRandomNamePart(db, 'male', 'first_name', name);
  for (const name of RANDOM_NAME_SEED.femaleNames) await insertRandomNamePart(db, 'female', 'first_name', name);
  for (const title of RANDOM_NAME_SEED.genericTitlesMale) await insertRandomNamePart(db, 'male', 'title', title);
  for (const title of RANDOM_NAME_SEED.genericTitlesFemale) await insertRandomNamePart(db, 'female', 'title', title);

  for (const [className, titles] of Object.entries(RANDOM_NAME_SEED.classTitlesMale)) {
    for (const title of titles as string[]) await insertRandomNamePart(db, 'male', 'title', title, className);
  }
  for (const [className, titles] of Object.entries(RANDOM_NAME_SEED.classTitlesFemale)) {
    for (const title of titles as string[]) await insertRandomNamePart(db, 'female', 'title', title, className);
  }

  for (const connector of RANDOM_LORE_CONNECTORS) {
    await db.runAsync(
      `INSERT OR IGNORE INTO random_lore_connectors (class_name, value, criador) VALUES ('', ?, 'base')`,
      [connector],
    );
  }

  for (const rule of RANDOM_RACE_LANGUAGE_RULES) {
    await db.runAsync(
      `INSERT OR IGNORE INTO random_race_language_rules (race_contains, base_languages, priority, criador) VALUES (?, ?, ?, 'base')`,
      [rule.raceContains, rule.baseLanguages, rule.priority],
    );
  }

  for (const [shortName, extras] of Object.entries(BG3_EXTRAS)) {
    await db.runAsync(
      `UPDATE bg3_companions SET languages = ?, origin_traits = ? WHERE short_name = ? OR name = ?`,
      [(extras as any).langs, (extras as any).traits, shortName, shortName],
    );
  }
}
