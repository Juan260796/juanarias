package co.edu.uniquindio.Repaso.EntradaDatos;

import javax.swing.*;
import java.util.Scanner;

public class EntradaDeDatos {
    public static void main(String[] args) {
       /* Scanner sc= new Scanner(System.in);
        System.out.println("Ingrese numero");
        int num1=sc.nextInt();
        System.out.println("Ingrese numero");
        int num2=sc.nextInt();
        int resultado= num1 + num2;
        System.out.println("El resultado es: "+resultado);*/

       //Solicitar string por consola

       /* Scanner sc= new Scanner(System.in);
        System.out.println("Ingrese un color");
        String color= sc.nextLine();
        System.out.println("El color es "+color);*/

        String strNum1= JOptionPane.showInputDialog("Ingrese numero: ");
        String strNum2= JOptionPane.showInputDialog("Ingrese numero: ");
        //Parsing de String a int
        int num1= Integer.parseInt(strNum1);
        int num2= Integer.parseInt(strNum2);
        int resultado = num1+num2;
        //Mostrar el resultado
        JOptionPane.showMessageDialog(null, "El resultado de la suma es " + resultado);


    }
}
