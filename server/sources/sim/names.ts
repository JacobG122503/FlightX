/**
 * Passenger names from ~30 cultural groups, picked to match where a flight
 * goes: roughly half the cabin from the origin country, a quarter from the
 * destination and the rest from anywhere. "_" in a name stands for a space.
 */
import type { Rng } from './random';

interface Group {
  first: string[];
  last: string[];
}

const g = (first: string, last: string): Group => ({
  first: first.split(' ').map((n) => n.replace(/_/g, ' ')),
  last: last.split(' ').map((n) => n.replace(/_/g, ' ')),
});

const GROUPS: Record<string, Group> = {
  anglo: g(
    'James Olivia Michael Emma William Ava Benjamin Sophia Henry Isabella Lucas Mia Jack Charlotte Owen Amelia Ethan Harper Noah Evelyn Daniel Abigail Matthew Emily Ryan Ella Nathan Grace Tyler Chloe Caleb Lily Logan Hannah Dylan Madison Connor Natalie Austin Sarah Brandon Megan Hunter Brooke Cole Kayla Mason Paige',
    'Smith Johnson Williams Brown Jones Miller Davis Wilson Anderson Taylor Thomas Moore Martin Thompson White Harris Clark Lewis Robinson Walker Young Allen King Wright Scott Hill Green Adams Baker Nelson Carter Mitchell Roberts Turner Phillips Campbell Parker Evans Edwards Collins Stewart Morris Cook Rogers Morgan Bell Murphy Bailey Cooper Reed',
  ),
  black_american: g(
    'Jamal Aaliyah Darnell Imani Tyrone Keisha DeShawn Ebony Malik Jasmine Andre Tamika Marcus Destiny Terrence Shanice Jaylen Nia Darius Zora Kareem Aisha Lamar Tiana Rashad Kiara Xavier Monique Isaiah Brianna',
    'Washington Jefferson Jackson Banks Booker Freeman Brooks Coleman Dawson Glover Hayes Holloway Jenkins Mosley Owens Pryor Rhodes Simmons Tolliver Wallace Whitfield Gaines Barnes Hairston Dorsey',
  ),
  irish: g(
    'Liam Aoife Cian Saoirse Conor Niamh Seán Siobhán Oisín Ciara Darragh Róisín Eoin Clodagh Pádraig Orla Ronan Gráinne Fionn Caoimhe Declan Éabha Ciarán Maeve Tadhg Sinéad Colm Aisling Cormac Bríd',
    "Murphy Kelly O'Sullivan Walsh O'Brien Byrne Ryan O'Connor O'Neill Reilly Doyle McCarthy Gallagher Doherty Kennedy Lynch Murray Quinn Moore McLoughlin Carroll Connolly Daly Brennan Fitzgerald",
  ),
  hispanic: g(
    'José María Juan Guadalupe Luis Ana Carlos Sofía Miguel Valentina Jorge Camila Alejandro Daniela Diego Isabel Javier Lucía Fernando Gabriela Ricardo Paola Andrés Carmen Mateo Ximena Santiago Renata Emilio Fernanda Rafael Mariana Pablo Elena Héctor Rosa',
    'García Rodríguez Martínez Hernández López González Pérez Sánchez Ramírez Torres Flores Rivera Gómez Díaz Cruz Morales Reyes Gutiérrez Ortiz Chávez Ramos Ruiz Vargas Castillo Jiménez Moreno Romero Herrera Medina Aguilar Vega Castro Mendoza Navarro',
  ),
  brazilian: g(
    'João Maria Pedro Ana Lucas Juliana Gabriel Beatriz Rafael Larissa Mateus Camila Thiago Fernanda Gustavo Letícia Felipe Mariana Bruno Isabela Leonardo Carolina Rodrigo Luana Caio Bianca Vinícius Yasmin Heitor Débora',
    'Silva Santos Oliveira Souza Rodrigues Ferreira Alves Pereira Lima Gomes Costa Ribeiro Martins Carvalho Almeida Lopes Soares Fernandes Vieira Barbosa Rocha Dias Nascimento Andrade Moreira Cardoso Teixeira Correia Pinto Azevedo',
  ),
  french: g(
    'Louis Camille Gabriel Léa Arthur Manon Jules Chloé Hugo Inès Raphaël Jade Théo Louise Nathan Zoé Mathis Alice Antoine Juliette Baptiste Margaux Clément Élodie Maxime Pauline Julien Céline Étienne Aurélie',
    'Martin Bernard Dubois Thomas Robert Richard Petit Durand Leroy Moreau Simon Laurent Lefebvre Michel Garcia David Bertrand Roux Vincent Fournier Morel Girard André Mercier Dupont Lambert Bonnet François Martinez Legrand',
  ),
  german: g(
    'Lukas Anna Maximilian Lena Felix Hannah Jonas Lea Leon Emilia Paul Marie Finn Sophie Elias Mia Moritz Laura Tobias Johanna Florian Katharina Niklas Clara Sebastian Greta Matthias Charlotte Jürgen Ursula',
    'Müller Schmidt Schneider Fischer Weber Meyer Wagner Becker Schulz Hoffmann Schäfer Koch Bauer Richter Klein Wolf Schröder Neumann Schwarz Zimmermann Braun Krüger Hofmann Hartmann Lange Werner Krause Lehmann Köhler Huber',
  ),
  italian: g(
    'Francesco Giulia Alessandro Sofia Lorenzo Aurora Leonardo Ginevra Matteo Beatrice Gabriele Alice Riccardo Chiara Tommaso Martina Edoardo Giorgia Marco Elisa Davide Francesca Luca Valentina Andrea Federica Giuseppe Rosa Antonio Paola',
    'Rossi Russo Ferrari Esposito Bianchi Romano Colombo Ricci Marino Greco Bruno Gallo Conti De_Luca Mancini Costa Giordano Rizzo Lombardi Moretti Barbieri Fontana Santoro Mariani Rinaldi Caruso Ferrara Galli Martini Leone',
  ),
  dutch: g(
    'Daan Emma Sem Julia Lucas Tess Levi Sophie Finn Anna Milan Zoë Jesse Sara Bram Fleur Thijs Lotte Ruben Iris Sven Noor Joris Femke Wouter Sanne Pieter Lieke Maarten Eva',
    'de_Jong Jansen de_Vries van_den_Berg van_Dijk Bakker Janssen Visser Smit Meijer de_Boer Mulder de_Groot Bos Vos Peters Hendriks van_Leeuwen Dekker Brouwer de_Wit Dijkstra Smits de_Graaf van_der_Meer',
  ),
  nordic: g(
    'Oscar Alma William Ella Lucas Freja Elias Astrid Hugo Saga Oliver Ingrid Liam Maja Axel Elsa Emil Linnea Magnus Sigrid Noah Ebba Erik Tuva Anders Signe Lars Karin Mikko Aino',
    'Andersson Johansson Karlsson Nilsson Eriksson Larsson Olsen Hansen Pedersen Nielsen Jensen Christensen Lindqvist Berg Lund Holm Dahl Haugen Johannessen Virtanen Korhonen Mäkinen Nieminen Jónsson Sigurðsson Bergström Lindgren Engström Halvorsen Strand',
  ),
  polish: g(
    'Jakub Zuzanna Jan Julia Antoni Maja Szymon Zofia Filip Hanna Kacper Lena Mateusz Alicja Wojciech Natalia Piotr Agnieszka Tomasz Katarzyna Michał Magdalena Paweł Joanna Krzysztof Ewa Marek Dorota Łukasz Karolina',
    'Nowak Kowalski Wiśniewski Wójcik Kowalczyk Kamiński Lewandowski Zieliński Szymański Woźniak Dąbrowski Kozłowski Jankowski Mazur Kwiatkowski Krawczyk Piotrowski Grabowski Nowakowski Pawłowski Michalski Adamczyk Dudek Zając Wieczorek',
  ),
  russian: g(
    'Alexander Anastasia Dmitry Maria Maxim Daria Ivan Sofia Artem Anna Mikhail Polina Nikita Viktoria Andrei Ekaterina Sergei Olga Pavel Tatiana Oleksandr Yulia Bohdan Oksana Vladimir Irina Yaroslav Svetlana Kirill Natalia',
    'Ivanov Smirnov Kuznetsov Popov Vasiliev Petrov Sokolov Mikhailov Novikov Fedorov Morozov Volkov Alekseev Lebedev Semenov Egorov Pavlov Kozlov Stepanov Nikolaev Shevchenko Kovalenko Bondarenko Tkachenko Melnyk Kravchenko Orlov Belov Zakharov Romanov',
  ),
  greek: g(
    'Georgios Maria Dimitrios Eleni Konstantinos Aikaterini Ioannis Vasiliki Nikolaos Sofia Panagiotis Angeliki Christos Despoina Athanasios Konstantina Michail Ioanna Evangelos Christina Spyridon Anastasia Alexandros Dimitra Stavros Theodora',
    'Papadopoulos Papadakis Nikolaidis Georgiou Pappas Vlachos Oikonomou Karagiannis Ioannou Dimitriou Konstantinidis Christodoulou Antoniou Makris Alexiou Panagiotopoulos Theodorou Athanasiou Michailidis Stavrou',
  ),
  turkish: g(
    'Yusuf Zeynep Eymen Elif Mustafa Defne Ömer Asel Mehmet Ayşe Emir Fatma Ahmet Hira Ali Merve Burak Esra Can Selin Kerem Ebru Emre Damla Murat Derya Serkan Gizem Hakan Büşra',
    'Yılmaz Kaya Demir Şahin Çelik Yıldız Yıldırım Öztürk Aydın Özdemir Arslan Doğan Kılıç Aslan Çetin Kara Koç Kurt Özkan Şimşek Polat Korkmaz Erdoğan Güneş Aksoy',
  ),
  arabic: g(
    'Mohammed Fatima Ahmed Aisha Omar Mariam Ali Layla Youssef Nour Hassan Sara Khalid Huda Ibrahim Amira Abdullah Rania Tariq Yasmin Karim Salma Hamza Dina Mahmoud Lina Faisal Reem Sami Zainab',
    'Al-Sayed Haddad Khalil Hassan Mansour Nasser Saleh Farouk Aziz Rahman Abdallah Hussein Darwish Kassem Khoury Mahmoud Najjar Qureshi Shalabi Suleiman Taha Youssef Zaki Bakr Al-Amin Al-Hashimi Al-Farsi Al-Mansouri Bennani Benali',
  ),
  persian: g(
    'Amir Fatemeh Reza Zahra Mohammad Maryam Ali Narges Hossein Shirin Mehdi Parisa Arash Leila Dariush Nasrin Kian Roya Farhad Mina Babak Azadeh Cyrus Golnaz Omid Setareh Navid Yasaman',
    'Hosseini Mohammadi Rezaei Ahmadi Karimi Moradi Jafari Rahimi Hashemi Ebrahimi Sadeghi Ghasemi Mousavi Kazemi Najafi Tehrani Shirazi Esfahani Farahani Bagheri Azizi Amini Nouri Rostami Javadi',
  ),
  hebrew: g(
    'David Noa Ariel Tamar Yosef Maya Daniel Shira Noam Yael Eitan Avigail Itai Michal Omer Hila Yonatan Talia Amit Rivka Gideon Naama Uri Liora Asher Eden',
    'Cohen Levi Mizrahi Peretz Biton Dahan Avraham Friedman Agbaria Malka Azoulay Katz Yosef David Amar Ohana Shapiro Goldberg Rosenberg Ben-David Weiss Hadad Gabay Ben-Ami Kaplan',
  ),
  indian: g(
    'Aarav Ananya Vivaan Diya Aditya Saanvi Arjun Aadhya Sai Isha Reyansh Myra Krishna Kavya Ishaan Riya Rohan Priya Vikram Neha Rahul Pooja Amit Sneha Karan Anjali Siddharth Shreya Rajesh Sunita',
    'Sharma Verma Gupta Singh Kumar Patel Mehta Joshi Agarwal Malhotra Kapoor Chopra Bansal Saxena Mishra Pandey Yadav Shah Desai Bhatt Chauhan Thakur Sinha Jain Arora Khanna Bose Banerjee Chatterjee Mukherjee',
  ),
  south_indian: g(
    'Arun Lakshmi Karthik Divya Suresh Meera Vijay Revathi Prakash Deepa Ganesh Keerthana Ramesh Nithya Senthil Aishwarya Venkat Swathi Harish Bhavana Anand Gayathri Mohan Sangeetha Raghav Pavithra',
    'Iyer Nair Reddy Rao Pillai Menon Krishnan Subramanian Raman Natarajan Venkatesh Srinivasan Narayanan Gopal Chandran Rajan Balakrishnan Murthy Hegde Shetty Kurian Varghese Thomas Naidu Achari',
  ),
  pakistani: g(
    'Muhammad Ayesha Ahmed Fatima Hamza Zainab Bilal Hira Usman Sana Ali Maryam Hassan Iqra Faisal Rabia Imran Nadia Zubair Saima Arif Farah Rizwan Amna Shahid Tahira Rahim Nusrat Tanvir Shirin',
    'Khan Ahmed Malik Hussain Qureshi Butt Chaudhry Sheikh Raza Iqbal Mirza Siddiqui Rana Javed Akhtar Abbasi Bhatti Haider Rahman Islam Hossain Chowdhury Uddin Miah Sarkar',
  ),
  chinese: g(
    'Wei Fang Jun Li Hao Mei Lei Xin Yang Jing Chen Hui Ming Yan Jian Ling Tao Xiu Bo Ying Kai Qing Zhi Rui Hong Lan Yu Shu Feng Xia',
    'Wang Li Zhang Liu Chen Yang Huang Zhao Wu Zhou Xu Sun Ma Zhu Hu Guo He Lin Gao Luo Zheng Liang Xie Song Tang Han Feng Deng Cao Peng',
  ),
  japanese: g(
    'Haruto Yui Sota Hina Yuto Aoi Riku Sakura Hinata Yuna Minato Mei Kaito Rin Ren Saki Takumi Miyu Daiki Nanami Hiroshi Yoko Kenji Keiko Takeshi Akiko Satoshi Emi Kazuki Ayaka',
    'Sato Suzuki Takahashi Tanaka Watanabe Ito Yamamoto Nakamura Kobayashi Kato Yoshida Yamada Sasaki Yamaguchi Matsumoto Inoue Kimura Hayashi Shimizu Yamazaki Mori Abe Ikeda Hashimoto Ishikawa Ogawa Fujita Okada Goto Hasegawa',
  ),
  korean: g(
    'Min-jun Seo-yeon Seo-jun Ji-woo Do-yun Ha-eun Ji-ho Seo-ah Joon-young Ji-min Hyun-woo Soo-ah Tae-yang Ye-jin Sung-min Da-eun Jae-won Yu-na Dong-hyun Eun-ji Young-ho Hye-jin Kyung-soo Mi-rae',
    'Kim Lee Park Choi Jung Kang Cho Yoon Jang Lim Han Oh Seo Shin Kwon Hwang Ahn Song Yoo Hong Jeon Ko Moon Yang Baek',
  ),
  vietnamese: g(
    'Minh Linh Anh Thu Duc Lan Huy Mai Khanh Hoa Tuan Ngoc Quang Trang Long Hanh Phuong Hieu Bao Nhung Thanh Huong Dung Vy Nam Yen Trung Thao',
    'Nguyen Tran Le Pham Hoang Huynh Phan Vu Vo Dang Bui Do Ho Ngo Duong Ly Truong Dinh Lam Mai',
  ),
  thai: g(
    'Somchai Siriporn Anan Kanya Niran Ploy Kittisak Nattaya Chaiwat Pimchanok Somsak Rattana Thanawat Supaporn Prasert Wanida Narong Arunee Pongsakorn Duangjai Weerapong Kulap',
    'Saetang Srisuk Wongsakul Chaiyaporn Boonmee Rattanakorn Thongchai Kongkaew Sukjai Phromma Charoenrat Intharasombat Jaidee Sombat Saelim Pattanapong Kaewmanee Siriwat',
  ),
  filipino: g(
    'Jose Maria Juan Angelica John_Paul Kristine Mark Princess Christian Jasmine Jericho Mary_Grace Rommel Divina Ramon Rowena Aldrin Lovely Bong Marites Rodel Jennilyn Arnel Cherry Joel Rhea',
    'Santos Reyes Cruz Bautista Ocampo Garcia Mendoza Torres Tomas Andrada Castillo Flores Villanueva Ramos Castro Rivera Aquino Navarro Salazar Mercado Dela_Cruz De_Leon Pascual Manalo Soriano',
  ),
  malay: g(
    'Muhammad Nur Ahmad Siti Aiman Aisyah Hafiz Nurul Iskandar Farah Rizal Intan Budi Dewi Agus Sri Eko Putri Arif Ayu Hendra Ratna Fajar Wulan Bayu Indah Rudi Lestari',
    'bin_Abdullah binti_Ismail Rahman Hamid Ibrahim Yusof Hassan Osman Wijaya Santoso Susanto Hidayat Pratama Saputra Kusuma Nugroho Setiawan Gunawan Halim Siregar Harahap Lubis Sinaga Tan Lim',
  ),
  west_african: g(
    'Chinedu Ngozi Oluwaseun Adaeze Emeka Funmilayo Kwame Abena Kofi Ama Tunde Yetunde Ifeanyi Chiamaka Obinna Folake Babatunde Nkechi Kwabena Akosua Segun Bisi Chukwuemeka Amarachi Kojo Efua Yaw Adwoa',
    'Okafor Adeyemi Okonkwo Mensah Boateng Nwosu Eze Adebayo Owusu Asante Balogun Obi Danjuma Ogunleye Abubakar Bello Oyelaran Agyemang Ofori Darko Oladipo Ibekwe Nnamdi Akande Ogundipe',
  ),
  east_african: g(
    'Baraka Amani Juma Neema Omondi Wanjiru Kipchoge Achieng Mwangi Zawadi Tesfaye Selam Dawit Hana Abebe Meron Yonas Tigist Otieno Imani Kamau Nyokabi Musa Rehema',
    'Mwangi Otieno Kamau Wanjiku Ochieng Kiprono Njoroge Mutua Odhiambo Kariuki Tadesse Bekele Haile Tesfaye Girma Alemu Mekonnen Desta Mohamed Ali Nyerere Mbeki Okello Ssempala',
  ),
  southern_african: g(
    'Thabo Lerato Sipho Nomvula Themba Zanele Mandla Thandiwe Bongani Palesa Lwazi Ayanda Sibusiso Naledi Tshepo Busisiwe Kagiso Nandi Pieter Annelie Johan Marike Willem Elsabe',
    'Dlamini Nkosi Ndlovu Khumalo Mthembu Zulu Mokoena Mahlangu Naidoo Botha van_der_Merwe Pretorius Venter du_Plessis Nel Mabuza Sithole Molefe Shabalala Ngcobo',
  ),
};

/** Country → mix of groups (weights). Countries not listed use GLOBAL. */
const MIX: Record<string, Record<string, number>> = {
  US: { anglo: 46, hispanic: 18, black_american: 12, chinese: 3, indian: 4, korean: 2, vietnamese: 2, filipino: 3, arabic: 2, italian: 2, irish: 2, german: 2, hebrew: 1, polish: 1 },
  CA: { anglo: 48, french: 20, chinese: 8, indian: 8, filipino: 4, italian: 3, arabic: 3, pakistani: 2, polish: 2, korean: 2 },
  GB: { anglo: 66, irish: 5, indian: 8, pakistani: 7, west_african: 4, polish: 4, chinese: 2, arabic: 2, italian: 2 },
  IE: { irish: 78, anglo: 10, polish: 8, brazilian: 4 },
  AU: { anglo: 66, chinese: 9, indian: 7, vietnamese: 4, italian: 4, greek: 3, filipino: 3, arabic: 2, korean: 2 },
  NZ: { anglo: 74, chinese: 8, indian: 8, filipino: 4, korean: 3, dutch: 3 },
  MX: { hispanic: 100 }, ES: { hispanic: 88, arabic: 5, brazilian: 3, russian: 2, french: 2 },
  AR: { hispanic: 85, italian: 15 }, CO: { hispanic: 100 }, CL: { hispanic: 100 }, PE: { hispanic: 100 }, VE: { hispanic: 100 }, CU: { hispanic: 100 }, DO: { hispanic: 100 },
  BR: { brazilian: 92, italian: 3, japanese: 2, german: 3 }, PT: { brazilian: 90, west_african: 5, french: 5 },
  FR: { french: 74, arabic: 12, west_african: 6, brazilian: 3, italian: 3, chinese: 2 },
  DE: { german: 78, turkish: 9, polish: 5, russian: 3, italian: 3, arabic: 2 }, AT: { german: 88, turkish: 6, polish: 6 }, CH: { german: 60, french: 25, italian: 15 },
  IT: { italian: 92, arabic: 3, russian: 3, chinese: 2 }, NL: { dutch: 84, turkish: 6, arabic: 6, indian: 4 }, BE: { dutch: 45, french: 45, arabic: 10 },
  SE: { nordic: 88, arabic: 6, persian: 3, polish: 3 }, NO: { nordic: 90, polish: 5, pakistani: 5 }, DK: { nordic: 92, turkish: 4, arabic: 4 }, FI: { nordic: 95, russian: 5 }, IS: { nordic: 95, polish: 5 },
  PL: { polish: 96, russian: 4 }, CZ: { polish: 60, russian: 30, german: 10 }, UA: { russian: 100 }, RU: { russian: 95, turkish: 5 },
  GR: { greek: 95, arabic: 5 }, CY: { greek: 90, turkish: 10 }, TR: { turkish: 96, arabic: 4 },
  AE: { arabic: 40, indian: 25, pakistani: 15, filipino: 12, anglo: 8 }, QA: { arabic: 40, indian: 25, filipino: 15, pakistani: 12, anglo: 8 },
  SA: { arabic: 80, pakistani: 8, indian: 6, filipino: 6 }, EG: { arabic: 100 }, JO: { arabic: 100 }, LB: { arabic: 100 }, MA: { arabic: 90, french: 10 }, IL: { hebrew: 80, arabic: 15, russian: 5 }, IR: { persian: 100 },
  IN: { indian: 68, south_indian: 32 }, PK: { pakistani: 100 }, BD: { pakistani: 100 }, LK: { south_indian: 100 },
  CN: { chinese: 100 }, TW: { chinese: 100 }, HK: { chinese: 92, anglo: 4, filipino: 4 }, SG: { chinese: 70, malay: 15, south_indian: 10, anglo: 5 },
  JP: { japanese: 96, chinese: 2, korean: 2 }, KR: { korean: 97, chinese: 3 }, VN: { vietnamese: 100 }, TH: { thai: 95, chinese: 5 }, PH: { filipino: 100 },
  ID: { malay: 92, chinese: 8 }, MY: { malay: 62, chinese: 25, south_indian: 13 },
  NG: { west_african: 100 }, GH: { west_african: 100 }, SN: { west_african: 80, french: 20 }, KE: { east_african: 100 }, TZ: { east_african: 100 }, ET: { east_african: 100 }, UG: { east_african: 100 },
  ZA: { southern_african: 70, anglo: 15, south_indian: 10, dutch: 5 },
};

const GLOBAL: Record<string, number> = Object.fromEntries(Object.keys(GROUPS).map((k) => [k, k === 'anglo' ? 6 : k === 'hispanic' || k === 'chinese' || k === 'indian' ? 4 : 2]));

const NATIONALITY: Record<string, string> = {
  anglo: 'US', black_american: 'US', irish: 'IE', hispanic: 'MX', brazilian: 'BR', french: 'FR', german: 'DE', italian: 'IT', dutch: 'NL',
  nordic: 'SE', polish: 'PL', russian: 'UA', greek: 'GR', turkish: 'TR', arabic: 'AE', persian: 'IR', hebrew: 'IL', indian: 'IN',
  south_indian: 'IN', pakistani: 'PK', chinese: 'CN', japanese: 'JP', korean: 'KR', vietnamese: 'VN', thai: 'TH', filipino: 'PH',
  malay: 'ID', west_african: 'NG', east_african: 'KE', southern_african: 'ZA',
};

export interface Person {
  name: string;
  age: number;
  /** ISO country code of the passenger's nationality. */
  nationality: string;
}

function pickWeighted(weights: Record<string, number>, rng: Rng): string {
  const keys = Object.keys(weights);
  return rng.weighted(keys, (k) => weights[k]);
}

function age(rng: Rng): number {
  const r = rng.next();
  if (r < 0.015) return rng.int(0, 1);
  if (r < 0.1) return rng.int(2, 17);
  if (r < 0.2) return rng.int(18, 24);
  if (r < 0.88) return rng.int(25, 64);
  return rng.int(65, 91);
}

/** A random passenger for a flight between two countries (ISO codes). */
export function person(originCountry: string, destCountry: string, rng: Rng): Person {
  const r = rng.next();
  const country = r < 0.55 ? originCountry : r < 0.8 ? destCountry : null;
  const mix = (country && MIX[country]) || GLOBAL;
  const group = pickWeighted(mix, rng);
  const names = GROUPS[group];
  return {
    name: `${rng.pick(names.first)} ${rng.pick(names.last)}`,
    age: age(rng),
    nationality: country && MIX[country] ? country : NATIONALITY[group],
  };
}

/** Random full name (for the "random name" button when adding custom passengers). */
export function randomName(rng: Rng): string {
  const names = GROUPS[pickWeighted(GLOBAL, rng)];
  return `${rng.pick(names.first)} ${rng.pick(names.last)}`;
}
